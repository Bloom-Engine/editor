// Prefab authoring mode.
//
// When the user enters prefab edit mode (via New Prefab or double-clicking
// a prefab in the asset panel), the viewport swaps to a neutral scene.
// All placement tools mutate editingPrefab.children instead of world.entities.
// Save writes *.prefab.json to the project's prefabsDir.

import { isKeyPressed, Key, drawText } from 'bloom';
import { createEmptyPrefab, PrefabData, PrefabChild, TransformData, Vec3Lit } from 'bloom/world';
import { savePrefab } from 'bloom/world';
import { EditorState } from '../state/editor-state';
import { rebuildAllSceneNodes } from '../world-sync/sync';
import { Theme } from '../ui/theme';

// Enter prefab edit mode with a new empty prefab.
export function enterNewPrefabMode(state: EditorState, id: string, name: string): void {
  state.editingPrefab = createEmptyPrefab(id, name);
  state.selection.ids.clear();
  state.selection.primary = null;
  // Clear the viewport scene — we'll render a neutral background.
  rebuildAllSceneNodes(state);
}

// Enter prefab edit mode for an existing prefab (loaded from catalog).
export function enterPrefabEditMode(state: EditorState, prefabId: string): void {
  const prefab = state.catalog.prefabs.get(prefabId);
  if (!prefab) return;
  // Deep-clone the prefab so edits don't mutate the catalog copy.
  state.editingPrefab = JSON.parse(JSON.stringify(prefab)) as PrefabData;
  state.selection.ids.clear();
  state.selection.primary = null;
  rebuildAllSceneNodes(state);
}

// Exit prefab edit mode, returning to the world.
export function exitPrefabMode(state: EditorState): void {
  state.editingPrefab = null;
  state.selection.ids.clear();
  state.selection.primary = null;
  rebuildAllSceneNodes(state);
}

// Save the current prefab to disk and update the catalog.
export function savePrefabToDisk(state: EditorState): boolean {
  if (!state.editingPrefab || !state.project) return false;
  const prefab = state.editingPrefab;
  const path = state.project.prefabsDir + '/' + prefab.id + '.prefab.json';
  const result = savePrefab(path, prefab);
  if (result.ok) {
    // Update the catalog entry.
    state.catalog.prefabs.set(prefab.id, JSON.parse(JSON.stringify(prefab)) as PrefabData);
    if (!state.catalog.prefabOrder.includes(prefab.id)) {
      state.catalog.prefabOrder.push(prefab.id);
    }
  }
  return result.ok;
}

// Add a child to the currently editing prefab.
export function addPrefabChild(
  state: EditorState,
  childId: string,
  modelRef: string | null,
  prefabRef: string | null,
  position: Vec3Lit,
): void {
  if (!state.editingPrefab) return;
  const child: PrefabChild = {
    id: childId,
    modelRef: modelRef,
    prefabRef: prefabRef,
    transform: {
      position: position,
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    },
    tint: null,
    tags: [],
  };
  state.editingPrefab.children.push(child);
}

// Draw the prefab mode breadcrumb bar (called from main loop when editing).
export function drawPrefabBreadcrumb(state: EditorState, screenW: number): void {
  if (!state.editingPrefab) return;
  const y = Theme.toolbarHeight;
  const text = 'Editing prefab: ' + state.editingPrefab.name + '  [ESC to exit, Ctrl+S to save]';
  drawText(text, 12, y + 4, Theme.fontSizeSmall, Theme.textAccent);
}

// Per-frame update. Handles ESC to exit and Ctrl+S to save.
export function updatePrefabTool(state: EditorState): void {
  if (!state.editingPrefab) return;

  if (isKeyPressed(Key.ESCAPE)) {
    exitPrefabMode(state);
  }
}
