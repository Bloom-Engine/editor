// Immediate-mode UI context — tracks mouse state, hot/active widget ids,
// scroll offsets, and the mouseCaptured flag that prevents viewport clicks
// from bleeding through when the user interacts with a panel.
//
// Usage: call `uiBeginFrame` at the start of each frame, draw all widgets,
// then call `uiEndFrame`. Read `ui.mouseCaptured` to decide whether the
// viewport should process mouse events.

import {
  getMouseX, getMouseY,
  isMouseButtonPressed, isMouseButtonDown, isMouseButtonReleased,
  getMouseDeltaX, getMouseDeltaY, getMouseWheel,
  MouseButton,
} from 'bloom';

export interface UiContext {
  // Per-frame mouse snapshot.
  mouseX: number;
  mouseY: number;
  mouseDownLeft: boolean;
  mousePressedLeft: boolean;
  mouseReleasedLeft: boolean;
  mouseDownRight: boolean;
  mouseDeltaX: number;
  mouseDeltaY: number;
  mouseWheel: number;

  // Widget interaction tracking.
  hotId: string | null;           // Widget currently under the mouse.
  activeId: string | null;        // Widget grabbed (mouse down started on it).

  // When true, the viewport must skip mouse processing this frame.
  mouseCaptured: boolean;

  // Scroll offsets per scrollable panel, keyed by panel id.
  scrollOffsets: Map<string, number>;

  // Layout cursor for auto-positioned widgets.
  cursorX: number;
  cursorY: number;
  panelX: number;
  panelY: number;
  panelW: number;
  panelH: number;

  // Vertical clip window widgets draw within. Set by beginPanel to the panel
  // bounds and narrowed by beginScrollRegion; widgets that would cross it are
  // skipped (cursor still advances, so scrolled-out content keeps its layout).
  clipTop: number;
  clipBottom: number;

  // Active scroll region (one at a time; regions never nest).
  scrollRegionTop: number;
  scrollRegionH: number;

  // Drag state (for dragFloat).
  dragStartValue: number;
  dragStartX: number;
}

export function createUiContext(): UiContext {
  return {
    mouseX: 0, mouseY: 0,
    mouseDownLeft: false, mousePressedLeft: false, mouseReleasedLeft: false,
    mouseDownRight: false,
    mouseDeltaX: 0, mouseDeltaY: 0,
    mouseWheel: 0,
    hotId: null, activeId: null,
    mouseCaptured: false,
    scrollOffsets: new Map<string, number>(),
    cursorX: 0, cursorY: 0,
    panelX: 0, panelY: 0, panelW: 0, panelH: 0,
    clipTop: 0, clipBottom: 100000,
    scrollRegionTop: 0, scrollRegionH: 0,
    dragStartValue: 0, dragStartX: 0,
  };
}

export function uiBeginFrame(ui: UiContext): void {
  ui.mouseX = getMouseX();
  ui.mouseY = getMouseY();
  ui.mouseDownLeft = isMouseButtonDown(MouseButton.LEFT);
  ui.mousePressedLeft = isMouseButtonPressed(MouseButton.LEFT);
  ui.mouseReleasedLeft = isMouseButtonReleased(MouseButton.LEFT);
  ui.mouseDownRight = isMouseButtonDown(MouseButton.RIGHT);
  ui.mouseDeltaX = getMouseDeltaX();
  ui.mouseDeltaY = getMouseDeltaY();
  ui.mouseWheel = getMouseWheel();

  ui.hotId = null;
  ui.mouseCaptured = false;
}

export function uiEndFrame(_ui: UiContext): void {
  // Nothing to do currently. Placeholder for future cleanup.
}

// Check whether a point is inside a rectangle.
export function pointInRect(
  px: number, py: number,
  rx: number, ry: number, rw: number, rh: number,
): boolean {
  return px >= rx && px < rx + rw && py >= ry && py < ry + rh;
}
