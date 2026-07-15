// Asset catalog — scans the project's model and prefab directories, loads
// models, computes bounds, and populates the EditorState catalog.
//
// Uses Perry's fs.readdirSync for directory listing and Bloom's loadModel
// for synchronous GLB loading. Async parallel loading via parallelMap would
// be faster for large catalogs but requires a loading screen; for now we
// block at startup (19 GLBs takes <1s on any modern machine).

import { readdirSync } from 'fs';
import { loadModel, getModelBounds } from 'bloom';
import { readFile } from 'bloom';
import { PrefabData } from 'bloom/world';
import { EditorState, ModelEntry, Project } from '../state/editor-state';
import { basenameNoExt, categoryFromName, joinPath } from './paths';
import { invalidatePrefabRegistry } from '../world-sync/sync';

export function loadAssetCatalog(state: EditorState): void {
  if (!state.project) return;
  const project = state.project;

  loadModels(state, project);
  loadPrefabs(state, project);
  loadTextures(state, project);
  invalidatePrefabRegistry();
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
    state.catalog.textureOrder.push(joinPath(project.texturesDir, file));
  }
}

function loadModels(state: EditorState, project: Project): void {
  let files: string[];
  try {
    files = readdirSync(project.modelsDir) as string[];
  } catch (e) {
    return; // Directory missing — not an error, just no models.
  }

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file.endsWith('.glb') && !file.endsWith('.gltf')) continue;

    const relPath = joinPath(project.modelsDir, file);
    const model = loadModel(relPath);
    if (model.handle === 0) continue;

    const bounds = getModelBounds(model);
    const entry: ModelEntry = {
      relPath: relPath,
      displayName: basenameNoExt(file),
      category: categoryFromName(file),
      modelHandle: model.handle,
      boundsMin: [bounds.min.x, bounds.min.y, bounds.min.z],
      boundsMax: [bounds.max.x, bounds.max.y, bounds.max.z],
      loaded: true,
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
