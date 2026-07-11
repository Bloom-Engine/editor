// World sync layer — per-frame reconciliation between EditorState.world and the
// Bloom scene graph. This is the heart of the editor.
//
// Tools never call createSceneNode directly. They mutate world.entities and push
// ids into pendingRebuild. Each frame, this module:
//   1. Processes pendingRebuild: creates or updates scene nodes.
//   2. Processes pendingDestroy: destroys scene nodes and unbinds handles.
//   3. If pendingTerrainRebuild: re-uploads the heightmap mesh.
//   4. If pendingEnvironmentSync: re-applies lighting/shadows.
//
// This keeps the scene graph always consistent with the data model, while
// letting tools batch their mutations without worrying about GPU side-effects.

import {
  createSceneNode, destroySceneNode,
  attachModelToNode, setSceneNodeTransform,
  setSceneNodeColor, setSceneNodeVisible, setSceneNodeParent,
  updateSceneNodeGeometry,
  enableShadows, disableShadows,
  addDirectionalLight,
  setAmbientLight,
  mat4Identity,
} from 'bloom';
import { trsToMat4 } from 'bloom/world';
import { buildHeightmapMesh } from 'bloom/world';
import { expandPrefab, PrefabLeaf, createPrefabRegistry, registerPrefab } from 'bloom/world';
import {
  EditorState, bindEntity, unbindEntity, handleOfEntity,
} from '../state/editor-state';

// Call this once per frame, after tools have mutated the world.
export function syncWorldToScene(state: EditorState): void {
  syncDestroys(state);
  syncRebuilds(state);
  syncTerrain(state);
  syncEnvironment(state);
}

// ---- entity creates & updates ----------------------------------------------

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
      // Update transform (and tint) on an existing scene node.
      setSceneNodeTransform(existingHandle, trsToMat4(entity.transform));
      if (entity.tint !== null) {
        setSceneNodeColor(
          existingHandle,
          entity.tint[0], entity.tint[1], entity.tint[2], entity.tint[3],
        );
      }
    } else {
      // Create a new scene node. Look up the model handle from the catalog.
      if (entity.modelRef !== null) {
        const modelEntry = state.catalog.models.get(entity.modelRef);
        if (modelEntry && modelEntry.loaded) {
          const node = createSceneNode();
          attachModelToNode(node, modelEntry.modelHandle, 0);
          setSceneNodeTransform(node, trsToMat4(entity.transform));
          if (entity.tint !== null) {
            setSceneNodeColor(
              node,
              entity.tint[0], entity.tint[1], entity.tint[2], entity.tint[3],
            );
          }
          setSceneNodeVisible(node, true);
          bindEntity(state.handles, entityId, node);
        }
      }
      // Prefab entities.
      if (entity.prefabRef !== null && entity.prefabRef.length > 0) {
        const registry = createPrefabRegistry();
        // Populate the registry from the catalog.
        for (const [id, prefab] of state.catalog.prefabs) {
          registerPrefab(registry, prefab);
        }
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
          if (me && me.loaded) {
            const leafNode = createSceneNode();
            attachModelToNode(leafNode, me.modelHandle, 0);
            setSceneNodeTransform(leafNode, leaf.worldMatrix);
            if (leaf.tint) setSceneNodeColor(leafNode, leaf.tint[0], leaf.tint[1], leaf.tint[2], leaf.tint[3]);
            setSceneNodeParent(leafNode, root);
            setSceneNodeVisible(leafNode, true);
          }
        }
        bindEntity(state.handles, entityId, root);
      }
    }
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

  if (!state.world.terrain) return;

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
  if (!state.pendingEnvironmentSync) return;
  state.pendingEnvironmentSync = false;

  const env = state.world.environment;

  setAmbientLight(
    { r: env.ambientColor[0] * 255, g: env.ambientColor[1] * 255, b: env.ambientColor[2] * 255, a: 255 },
    env.ambientIntensity,
  );

  addDirectionalLight(
    env.sunDirection[0], env.sunDirection[1], env.sunDirection[2],
    env.sunColor[0], env.sunColor[1], env.sunColor[2],
    env.sunIntensity,
  );

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
  state.pendingEnvironmentSync = true;
}
