// Thin wrapper around bloom/world loader/saver for the editor.
// Handles file path resolution and state updates (modified flag, world path).

import { loadWorld, saveWorld, createEmptyWorld } from 'bloom/world';
import { EditorState } from '../state/editor-state';
import { rebuildAllSceneNodes } from '../world-sync/sync';
import { joinPath } from './paths';

export function openWorld(state: EditorState, path: string): boolean {
  try {
    const world = loadWorld(path);
    state.world = world;
    state.worldPath = path;
    state.modified = false;
    state.selection.ids.clear();
    state.selection.primary = null;
    rebuildAllSceneNodes(state);
    return true;
  } catch (e) {
    return false;
  }
}

export function saveCurrentWorld(state: EditorState): boolean {
  if (!state.worldPath) return false;
  const result = saveWorld(state.worldPath, state.world);
  if (result.ok) {
    state.modified = false;
  }
  return result.ok;
}

export function newWorld(state: EditorState): void {
  state.world = createEmptyWorld('untitled', 'Untitled World');
  state.worldPath = null;
  state.modified = false;
  state.selection.ids.clear();
  state.selection.primary = null;
  rebuildAllSceneNodes(state);
}

// Auto-generate a save path for new worlds.
export function defaultSavePath(state: EditorState): string {
  if (!state.project) return 'untitled.world.json';
  return joinPath(state.project.worldsDir, state.world.id + '.world.json');
}
