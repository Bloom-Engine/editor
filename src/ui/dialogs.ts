// File dialog wrappers. Uses the native file dialog FFI (E5b).

import { openFileDialog, saveFileDialog } from 'bloom';
import { EditorState } from '../state/editor-state';
import { openWorld, saveCurrentWorld, defaultSavePath } from '../io/world-io';
import { saveWorld } from 'bloom/world';

export function showOpenWorldDialog(state: EditorState): void {
  const path = openFileDialog('world.json', 'Open World');
  if (path && path.length > 0) {
    openWorld(state, path);
  }
}

export function showSaveWorldDialog(state: EditorState): void {
  const suggestedName = state.world.id + '.world.json';
  const path = saveFileDialog(suggestedName, 'Save World');
  if (path && path.length > 0) {
    state.worldPath = path;
    saveCurrentWorld(state);
  }
}
