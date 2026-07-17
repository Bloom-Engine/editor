// Thin wrapper around bloom/world loader/saver for the editor.
// Handles file path resolution and state updates (modified flag, world path).

import { fileExists } from 'bloom';
import { loadWorld, saveWorld, createEmptyWorld, listUnknownWorldFields } from 'bloom/world';
import { EditorState, setStatus } from '../state/editor-state';
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

    // The saver is schema-explicit: fields it doesn't know are dropped on the
    // first Ctrl+S. loadWorld already printed each one to the console; the
    // status bar makes sure the user saw it BEFORE saving, not after.
    const unknown = listUnknownWorldFields(world);
    if (unknown.length > 0) {
      setStatus(state,
        'This file has ' + unknown.length + ' field(s) this editor does not know (e.g. ' +
        unknown[0] + ') — saving will DROP them. See console.');
    } else if (fileExists(path + '.recover')) {
      // A previous session closed with unsaved changes on this world.
      setStatus(state, 'Unsaved changes from a previous session exist: ' + path + '.recover');
      console.error('openWorld: recovery file present: ' + path + '.recover' +
        ' — open it with --world to inspect, delete it to dismiss.');
    }
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
