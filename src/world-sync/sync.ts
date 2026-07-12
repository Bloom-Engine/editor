// World sync layer — per-frame reconciliation between EditorState.world and the
// Bloom scene graph. This is the heart of the editor.
//
// Tools never call createSceneNode directly. They mutate world.entities and push
// ids into pendingRebuild. Each frame, this module:
//   1. Processes pendingRebuild: creates or updates scene nodes.
//   2. Processes pendingDestroy: destroys scene nodes and unbinds handles.
//   3. If pendingTerrainRebuild: re-uploads (or removes) the heightmap mesh.
//   4. Re-applies ambient/sun/fog every frame (the renderer's begin_frame
//      resets the lighting block); shadow toggles stay behind the dirty flag.
//
// This keeps the scene graph always consistent with the data model, while
// letting tools batch their mutations without worrying about GPU side-effects.

import {
  createSceneNode, destroySceneNode,
  attachModelToNode, setSceneNodeTransform,
  setSceneNodeColor, setSceneNodeVisible, setSceneNodeParent,
  updateSceneNodeGeometry,
  enableShadows, disableShadows,
  setAmbientLight, setDirectionalLight,
  genMeshCube, vec3,
  mat4Identity,
} from 'bloom';
import { setFog } from 'bloom/core';
import { trsToMat4 } from 'bloom/world';
import { buildHeightmapMesh } from 'bloom/world';
import { expandPrefab, PrefabLeaf, createPrefabRegistry, registerPrefab, PrefabRegistry } from 'bloom/world';
import { spawnWaterVolume, spawnRiver, applyWorldLights } from 'bloom/world';
import { EntityData, Vec3Lit, Mat4Lit } from 'bloom/world';
import {
  EditorState, bindEntity, unbindEntity, handleOfEntity,
} from '../state/editor-state';

// Call this once per frame, after tools have mutated the world.
export function syncWorldToScene(state: EditorState): void {
  syncDestroys(state);
  syncRebuilds(state);
  syncTerrain(state);
  syncWaterAndRivers(state);
  syncEnvironment(state);
}

// ---- water & rivers ----------------------------------------------------------
//
// Rendered through the engine's shared spawn helpers (bloom/world's render.ts),
// the same ones `instantiateWorld` uses, so what you see here is what the game
// shows. Tools set `pendingWaterRebuild` after any add/edit/remove; we tear the
// nodes down and respawn them, which is cheap at authoring-time volumes and
// avoids a per-property update API for every water knob.
function syncWaterAndRivers(state: EditorState): void {
  if (!state.pendingWaterRebuild) return;
  state.pendingWaterRebuild = false;

  for (let i = 0; i < state.waterHandles.length; i++) {
    if (state.waterHandles[i] !== 0) destroySceneNode(state.waterHandles[i]);
  }
  for (let i = 0; i < state.riverHandles.length; i++) {
    if (state.riverHandles[i] !== 0) destroySceneNode(state.riverHandles[i]);
  }
  state.waterHandles = [];
  state.riverHandles = [];

  for (let i = 0; i < state.world.water.length; i++) {
    state.waterHandles.push(spawnWaterVolume(state.world.water[i]));
  }
  for (let i = 0; i < state.world.rivers.length; i++) {
    state.riverHandles.push(spawnRiver(state.world.rivers[i]));
  }
}

// ---- placeholder rendering ---------------------------------------------------
//
// Entities whose model is missing — including sentinel refs like
// `_gizmo_box.glb` that some games use for pure-data marker entities — must
// still be visible and pickable, or they can never be selected or edited.
// They render as a colored cube: a shared unit-cube model, sized by the
// `userData.halfExtents` convention (full extents = 2 × halfExtents, matching
// how games draw these boxes) and then by the entity transform.

let placeholderCube = 0;

function getPlaceholderCube(): number {
  if (placeholderCube === 0) {
    placeholderCube = genMeshCube(1, 1, 1).handle;
  }
  return placeholderCube;
}

// Stable display colors for well-known userData.kind values. Unknown kinds
// hash to a stable hue (two kinds never silently share a color); entities with
// no kind at all get "missing model" magenta.
const KIND_COLORS = new Map<string, Vec3Lit>([
  ['player_spawn', [90, 220, 120]],
  ['collider_box', [150, 150, 158]],
  ['point_light', [255, 216, 96]],
  ['enemy_spawner', [230, 84, 84]],
  ['weapon_pickup', [84, 180, 255]],
  ['wave_config', [200, 105, 230]],
]);

// static_mesh placeholders take their color from the first tag — the same
// vocabulary the shooter's baker maps to paint categories.
const MESH_TAG_COLORS = new Map<string, Vec3Lit>([
  ['building', [208, 178, 140]],
  ['terrain', [110, 162, 92]],
  ['prop', [165, 122, 82]],
]);

function hueToRgb(hue: number): Vec3Lit {
  // HSV with s=0.6, v=0.85, folded into 0-255.
  const h = hue / 60;
  const c = 0.85 * 0.6;
  const x = c * (1 - Math.abs((h % 2) - 1));
  const m = 0.85 - c;
  let r = 0, g = 0, b = 0;
  if (h < 1) { r = c; g = x; }
  else if (h < 2) { r = x; g = c; }
  else if (h < 3) { g = c; b = x; }
  else if (h < 4) { g = x; b = c; }
  else if (h < 5) { r = x; b = c; }
  else { r = c; b = x; }
  return [Math.floor((r + m) * 255), Math.floor((g + m) * 255), Math.floor((b + m) * 255)];
}

function placeholderColor(entity: EntityData): Vec3Lit {
  const kind = entity.userData['kind'];
  if (kind === undefined || kind === '') return [255, 0, 255];
  if (kind === 'static_mesh') {
    const tag = entity.tags.length > 0 ? entity.tags[0] : '';
    const byTag = MESH_TAG_COLORS.get(tag);
    if (byTag) return byTag;
    return [172, 172, 172];
  }
  const known = KIND_COLORS.get(kind);
  if (known) return known;
  let h = 0;
  for (let i = 0; i < kind.length; i++) h = ((h * 31) + kind.charCodeAt(i)) | 0;
  return hueToRgb(((h % 360) + 360) % 360);
}

// Parse the "x, y, z" userData.halfExtents convention. Null when absent or
// malformed (the placeholder then stays a unit cube).
function parseHalfExtents(entity: EntityData): Vec3Lit | null {
  const s = entity.userData['halfExtents'];
  if (s === undefined || s === '') return null;
  const parts = s.split(',');
  if (parts.length !== 3) return null;
  const x = parseFloat(parts[0]);
  const y = parseFloat(parts[1]);
  const z = parseFloat(parts[2]);
  if (x !== x || y !== y || z !== z) return null;
  return [x, y, z];
}

// Entity transform with the box extents folded in as a post-multiplied local
// scale (column-major: scale each basis column).
function placeholderMatrix(entity: EntityData): Mat4Lit {
  const m = trsToMat4(entity.transform);
  const he = parseHalfExtents(entity);
  if (he !== null) {
    const ex = he[0] * 2, ey = he[1] * 2, ez = he[2] * 2;
    for (let i = 0; i < 4; i++) {
      m[i] *= ex;
      m[4 + i] *= ey;
      m[8 + i] *= ez;
    }
  }
  return m;
}

// True when this entity renders as a placeholder cube rather than a real model.
function isPlaceholder(state: EditorState, entity: EntityData): boolean {
  if (entity.prefabRef !== null && entity.prefabRef.length > 0) return false;
  if (entity.modelRef === null || entity.modelRef.length === 0) return true;
  const me = state.catalog.models.get(entity.modelRef);
  return !(me && me.loaded);
}

// ---- prefab registry cache ---------------------------------------------------

// Built lazily from the catalog and reused across frames — rebuilding it per
// prefab entity was pure waste. Invalidate whenever the catalog changes
// (loadAssetCatalog calls this; prefab saves must too).
let prefabRegistryCache: PrefabRegistry | null = null;

export function invalidatePrefabRegistry(): void {
  prefabRegistryCache = null;
}

function getPrefabRegistry(state: EditorState): PrefabRegistry {
  if (prefabRegistryCache === null) {
    prefabRegistryCache = createPrefabRegistry();
    for (const [, prefab] of state.catalog.prefabs) {
      registerPrefab(prefabRegistryCache, prefab);
    }
  }
  return prefabRegistryCache;
}

// ---- entity creates & updates ----------------------------------------------

function applyTint(node: number, tint: number[]): void {
  // World-format tints are 0-1 floats; the scene API takes 0-255.
  setSceneNodeColor(node, tint[0] * 255, tint[1] * 255, tint[2] * 255, tint[3] * 255);
}

function syncRebuilds(state: EditorState): void {
  if (state.pendingRebuild.size === 0) return;

  const ids = Array.from(state.pendingRebuild);
  state.pendingRebuild.clear();

  for (let i = 0; i < ids.length; i++) {
    const entityId = ids[i];
    const entity = state.world.entities.find(e => e.id === entityId);
    if (!entity) continue;

    const existingHandle = handleOfEntity(state.handles, entityId);

    if (existingHandle !== 0) {
      // Update transform (and tint) on an existing scene node. Placeholder
      // nodes keep their halfExtents scale folded into the matrix.
      const m = isPlaceholder(state, entity) ? placeholderMatrix(entity) : trsToMat4(entity.transform);
      setSceneNodeTransform(existingHandle, m);
      if (entity.tint !== null) {
        applyTint(existingHandle, entity.tint);
      }
      continue;
    }

    // Exactly one of modelRef / prefabRef should be set; if both are, the
    // prefab wins and the modelRef is ignored (a second node here would leak
    // and clobber the pick binding).
    if (entity.prefabRef !== null && entity.prefabRef.length > 0) {
      const registry = getPrefabRegistry(state);
      const root = createSceneNode();
      setSceneNodeTransform(root, trsToMat4(entity.transform));
      setSceneNodeVisible(root, true);

      const leaves: PrefabLeaf[] = [];
      const errors: string[] = [];
      const visited = new Set<string>();
      expandPrefab(registry, entity.prefabRef, mat4Identity(), entity.tint, entity.tags, leaves, errors, visited, entity.id);

      for (let li = 0; li < leaves.length; li++) {
        const leaf = leaves[li];
        const me = state.catalog.models.get(leaf.modelRef);
        const leafNode = createSceneNode();
        if (me && me.loaded) {
          attachModelToNode(leafNode, me.modelHandle, 0);
          if (leaf.tint) applyTint(leafNode, leaf.tint);
        } else {
          // Missing leaf model — same placeholder treatment as entities.
          attachModelToNode(leafNode, getPlaceholderCube(), 0);
          if (leaf.tint) applyTint(leafNode, leaf.tint);
          else setSceneNodeColor(leafNode, 255, 0, 255, 255);
        }
        setSceneNodeTransform(leafNode, leaf.worldMatrix);
        setSceneNodeParent(leafNode, root);
        setSceneNodeVisible(leafNode, true);
      }
      bindEntity(state.handles, entityId, root);
      continue;
    }

    // Model entity — real mesh when loaded, colored placeholder cube when the
    // ref is missing/sentinel, so every entity is visible and pickable.
    const node = createSceneNode();
    const modelEntry = entity.modelRef !== null ? state.catalog.models.get(entity.modelRef) : undefined;
    if (modelEntry && modelEntry.loaded) {
      attachModelToNode(node, modelEntry.modelHandle, 0);
      setSceneNodeTransform(node, trsToMat4(entity.transform));
      if (entity.tint !== null) {
        applyTint(node, entity.tint);
      }
    } else {
      attachModelToNode(node, getPlaceholderCube(), 0);
      setSceneNodeTransform(node, placeholderMatrix(entity));
      if (entity.tint !== null) {
        applyTint(node, entity.tint);
      } else {
        const c = placeholderColor(entity);
        setSceneNodeColor(node, c[0], c[1], c[2], 255);
      }
    }
    setSceneNodeVisible(node, true);
    bindEntity(state.handles, entityId, node);
  }
}

// ---- entity destroys -------------------------------------------------------

function syncDestroys(state: EditorState): void {
  if (state.pendingDestroy.size === 0) return;

  const handles = Array.from(state.pendingDestroy);
  state.pendingDestroy.clear();

  for (let i = 0; i < handles.length; i++) {
    const handle = handles[i];
    // Find the entity id bound to this handle and unbind it.
    const id = state.handles.byHandle.get(handle);
    if (id !== undefined) {
      unbindEntity(state.handles, id);
    }
    destroySceneNode(handle);
  }
}

// ---- terrain ---------------------------------------------------------------

function syncTerrain(state: EditorState): void {
  if (!state.pendingTerrainRebuild) return;
  state.pendingTerrainRebuild = false;

  if (!state.world.terrain) {
    // Terrain was removed (e.g. CreateTerrainCommand undo) — drop the node.
    if (state.terrainHandle !== 0) {
      destroySceneNode(state.terrainHandle);
      state.terrainHandle = 0;
    }
    return;
  }

  const mesh = buildHeightmapMesh(state.world.terrain);

  if (state.terrainHandle === 0) {
    // First build — create the terrain node.
    const node = createSceneNode();
    updateSceneNodeGeometry(node, mesh.vertices, mesh.indices);
    setSceneNodeTransform(node, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    setSceneNodeVisible(node, true);
    state.terrainHandle = node;
  } else {
    // Re-upload geometry into the existing node.
    updateSceneNodeGeometry(state.terrainHandle, mesh.vertices, mesh.indices);
  }
}

// ---- environment -----------------------------------------------------------

function syncEnvironment(state: EditorState): void {
  // The renderer's begin_frame resets the lighting block every frame
  // (immediate-mode convention — the same reason the shooter re-sets
  // sun/ambient per frame), so ambient, sun, and fog are re-applied
  // unconditionally. setDirectionalLight replaces the sun in place;
  // addDirectionalLight here would accumulate one extra light per call.
  const env = state.world.environment;

  setAmbientLight(
    {
      r: Math.floor(env.ambientColor[0] * 255),
      g: Math.floor(env.ambientColor[1] * 255),
      b: Math.floor(env.ambientColor[2] * 255),
      a: 255,
    },
    env.ambientIntensity,
  );

  setDirectionalLight(
    vec3(env.sunDirection[0], env.sunDirection[1], env.sunDirection[2]),
    {
      r: Math.floor(env.sunColor[0] * 255),
      g: Math.floor(env.sunColor[1] * 255),
      b: Math.floor(env.sunColor[2] * 255),
      a: 255,
    },
    env.sunIntensity,
  );

  // The world's point lights, re-submitted for the same reason as the sun: the
  // renderer clears its lighting block every frame. This is what lets the editor
  // preview a world's lighting rather than guessing at it.
  applyWorldLights(state.world);

  // The engine's fog is exponential height fog while the schema stores a
  // linear start/end pair — approximate with a density that reaches ~95%
  // extinction at fogEnd, near-uniform over height.
  if (env.fogEnd > 0.0001) {
    setFog(env.fogColor[0], env.fogColor[1], env.fogColor[2], 3.0 / env.fogEnd, 0, 0.02);
  } else {
    setFog(env.fogColor[0], env.fogColor[1], env.fogColor[2], 0, 0, 0.02);
  }

  // Shadow toggling swaps render passes — only on explicit change.
  if (!state.pendingEnvironmentSync) return;
  state.pendingEnvironmentSync = false;

  if (env.shadowsEnabled) {
    enableShadows();
  } else {
    disableShadows();
  }
}

// ---- full rebuild (on world load) ------------------------------------------

// Call this when a new world is loaded to rebuild everything from scratch.
// Destroys all existing scene nodes and re-creates them from the world data.
export function rebuildAllSceneNodes(state: EditorState): void {
  // Destroy all existing entity nodes.
  const handles = Array.from(state.handles.byEntity.values());
  for (let i = 0; i < handles.length; i++) {
    destroySceneNode(handles[i]);
  }
  state.handles.byEntity.clear();
  state.handles.byHandle.clear();

  // Destroy terrain node.
  if (state.terrainHandle !== 0) {
    destroySceneNode(state.terrainHandle);
    state.terrainHandle = 0;
  }

  // Mark everything for rebuild.
  for (let i = 0; i < state.world.entities.length; i++) {
    state.pendingRebuild.add(state.world.entities[i].id);
  }
  if (state.world.terrain !== null) {
    state.pendingTerrainRebuild = true;
  }
  state.pendingWaterRebuild = true;
  state.pendingEnvironmentSync = true;
}
