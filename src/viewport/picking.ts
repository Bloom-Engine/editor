// Viewport picking: wraps Bloom's pickScene with gizmo priority, mouseCaptured
// guard, and entity handle resolution. Called once per frame to set hover, and
// on left-click to select / place.

import {
  pickScene, setPostFxSelected, setPostFxHovered, enablePostFx,
} from 'bloom/scene';
import {
  EditorState, entityOfHandle, handleOfEntity,
} from '../state/editor-state';

// Call once at startup to enable the outline post-FX pipeline.
export function initPicking(): void {
  enablePostFx();
}

// Per-frame hover update. Sets the hovered outline on whatever entity is under
// the mouse, unless the mouse is over a UI panel (mouseCaptured) or a gizmo.
export function updateHover(
  state: EditorState,
  mouseX: number,
  mouseY: number,
  mouseCaptured: boolean,
): void {
  if (mouseCaptured || state.playtesting) {
    setPostFxHovered(0);
    return;
  }
  const hit = pickScene(mouseX, mouseY);
  if (!hit.hit) {
    setPostFxHovered(0);
    return;
  }
  const id = entityOfHandle(state.handles, hit.handle);
  if (id !== null) {
    setPostFxHovered(hit.handle);
  } else {
    setPostFxHovered(0);
  }
}

// Update the outline to match the current selection.
export function syncSelectionOutline(state: EditorState): void {
  if (state.selection.primary !== null) {
    const h = handleOfEntity(state.handles, state.selection.primary);
    setPostFxSelected(h);
  } else {
    setPostFxSelected(0);
  }
}

// Attempt to pick an entity under the mouse. Returns the entity id or null.
// Does NOT mutate state — the caller decides what to do with the hit.
export function pickEntityAtMouse(
  state: EditorState,
  mouseX: number,
  mouseY: number,
): string | null {
  const hit = pickScene(mouseX, mouseY);
  if (!hit.hit) return null;
  return entityOfHandle(state.handles, hit.handle);
}
