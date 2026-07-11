// Select tool — click to pick an entity, click empty space to deselect.
// Supports Shift-click for multi-select.

import { getMouseX, getMouseY, isMouseButtonPressed, isKeyDown, MouseButton, Key } from 'bloom';
import { EditorState } from '../state/editor-state';
import { pickEntityAtMouse, syncSelectionOutline } from '../viewport/picking';

export function handleSelectClick(state: EditorState): void {
  if (state.activeTool !== 'select' && state.activeTool !== 'transform') return;

  const mx = getMouseX();
  const my = getMouseY();
  const pickedId = pickEntityAtMouse(state, mx, my);
  const shift = isKeyDown(Key.LeftShift) || isKeyDown(Key.RightShift);

  if (pickedId !== null) {
    if (shift) {
      // Toggle selection.
      if (state.selection.ids.has(pickedId)) {
        state.selection.ids.delete(pickedId);
        if (state.selection.primary === pickedId) {
          // Promote another selected entity or clear.
          const remaining = Array.from(state.selection.ids);
          state.selection.primary = remaining.length > 0 ? remaining[0] : null;
        }
      } else {
        state.selection.ids.add(pickedId);
        state.selection.primary = pickedId;
      }
    } else {
      state.selection.ids.clear();
      state.selection.ids.add(pickedId);
      state.selection.primary = pickedId;
    }
  } else {
    if (!shift) {
      state.selection.ids.clear();
      state.selection.primary = null;
    }
  }
  syncSelectionOutline(state);
}
