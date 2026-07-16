// Asset catalog — scans the project's model and prefab directories and
// populates the EditorState catalog.
//
// Models load INCREMENTALLY: loadAssetCatalog lists files and creates
// unloaded stub entries (instant), and pumpAssetCatalog — called once per
// frame from the main loop — loads one GLB per frame. Entities whose model
// just arrived are rebuilt from placeholder cube to real mesh on the spot.
// The old behavior loaded everything synchronously at startup, which was a
// ~20 s black window on the shooter's 26 GLBs; now the world is visible and
// editable immediately, with meshes streaming in.

import { readdirSync } from 'fs';
import { loadModel, getModelBounds } from 'bloom';
import { readFile } from 'bloom';
import { PrefabData } from 'bloom/world';
import {
  EditorState, ModelEntry, Project, handleOfEntity, setStatus,
} from '../state/editor-state';
import { basenameNoExt, categoryFromName, joinPath, projectRelative } from './paths';
import { invalidatePrefabRegistry } from '../world-sync/sync';

// Reset + relist. Cheap: no GLB is opened here. Safe to call again when
// switching projects (models from the old project leak their GPU handles —
// the engine has no unloadModel — but a project switch is rare enough that
// this is a known cost, not a bug).
export function loadAssetCatalog(state: EditorState): void {
  state.catalog.models.clear();
  state.catalog.prefabs.clear();
  state.catalog.modelOrder.length = 0;
  state.catalog.prefabOrder.length = 0;
  state.catalog.textureOrder.length = 0;

  if (!state.project) return;
  const project = state.project;

  listModels(state, project);
  loadPrefabs(state, project);
  loadTextures(state, project);
  invalidatePrefabRegistry();
}

// Load up to `maxPerFrame` pending models. Returns how many entries are still
// pending, so the caller can surface progress. One per frame keeps the editor
// interactive while a big catalog streams in.
export function pumpAssetCatalog(state: EditorState, maxPerFrame: number): number {
  let loadedThisFrame = 0;
  let pending = 0;

  for (let i = 0; i < state.catalog.modelOrder.length; i++) {
    const entry = state.catalog.models.get(state.catalog.modelOrder[i]);
    if (!entry || entry.loaded || entry.failed) continue;

    if (loadedThisFrame >= maxPerFrame) {
      pending++;
      continue;
    }

    const model = loadModel(entry.filePath);
    loadedThisFrame++;
    if (model.handle === 0) {
      // Unreadable GLB: mark failed so we don't retry every frame. Entities
      // referencing it stay placeholder boxes, same as a missing file.
      entry.failed = true;
      console.error('asset catalog: failed to load ' + entry.filePath);
      continue;
    }

    const bounds = getModelBounds(model);
    entry.modelHandle = model.handle;
    entry.boundsMin = [bounds.min.x, bounds.min.y, bounds.min.z];
    entry.boundsMax = [bounds.max.x, bounds.max.y, bounds.max.z];
    entry.loaded = true;
    onModelLoaded(state, entry.relPath);
  }

  return pending;
}

// A model just became available: swap every placeholder that was standing in
// for it. Prefab-instance entities rebuild too — any of their leaves might
// reference the new model (conservative, but loads are a startup-only burst).
function onModelLoaded(state: EditorState, relPath: string): void {
  for (let i = 0; i < state.world.entities.length; i++) {
    const e = state.world.entities[i];
    const usesModel = e.modelRef === relPath;
    const isPrefab = e.prefabRef !== null && e.prefabRef.length > 0;
    if (!usesModel && !isPrefab) continue;
    const handle = handleOfEntity(state.handles, e.id);
    if (handle !== 0) state.pendingDestroy.add(handle);
    state.pendingRebuild.add(e.id);
  }
}

/// List the texture files, but do NOT load them.
///
/// Splat layers only ever store a path — the game decodes the image, the editor
/// shows a mask colour. Loading forty 2K PNGs into VRAM at startup so the layer
/// panel can print their names would be the most expensive no-op in the program.
function loadTextures(state: EditorState, project: Project): void {
  let files: string[];
  try {
    files = readdirSync(project.texturesDir) as string[];
  } catch (e) {
    return; // No textures dir — the layer picker just comes up empty.
  }

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file.endsWith('.png') && !file.endsWith('.jpg') && !file.endsWith('.jpeg')) continue;
    // Project-relative: these strings become splat-layer textureRefs in the
    // world file, which the GAME resolves from its own root.
    state.catalog.textureOrder.push(
      projectRelative(project.rootDir, joinPath(project.texturesDir, file)));
  }
}

function listModels(state: EditorState, project: Project): void {
  let files: string[];
  try {
    files = readdirSync(project.modelsDir) as string[];
  } catch (e) {
    return; // Directory missing — not an error, just no models.
  }

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file.endsWith('.glb') && !file.endsWith('.gltf')) continue;

    // filePath opens the file; relPath (project-relative) is the KEY and must
    // equal the world's modelRef exactly — a Map.get has no notion of
    // "equivalent path". See projectRelative in paths.ts for the history.
    const filePath = joinPath(project.modelsDir, file);
    const relPath = projectRelative(project.rootDir, filePath);
    const entry: ModelEntry = {
      relPath: relPath,
      filePath: filePath,
      displayName: basenameNoExt(file),
      category: categoryFromName(file),
      modelHandle: 0,
      boundsMin: [0, 0, 0],
      boundsMax: [0, 0, 0],
      loaded: false,
      failed: false,
    };

    state.catalog.models.set(relPath, entry);
    state.catalog.modelOrder.push(relPath);
  }
}

function loadPrefabs(state: EditorState, project: Project): void {
  let files: string[];
  try {
    files = readdirSync(project.prefabsDir) as string[];
  } catch (e) {
    return;
  }

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file.endsWith('.prefab.json')) continue;

    const relPath = joinPath(project.prefabsDir, file);
    const text = readFile(relPath);
    if (!text || text.length === 0) continue;

    try {
      const prefab = JSON.parse(text) as PrefabData;
      state.catalog.prefabs.set(prefab.id, prefab);
      state.catalog.prefabOrder.push(prefab.id);
    } catch (e) {
      // Skip malformed prefab files.
    }
  }
}
