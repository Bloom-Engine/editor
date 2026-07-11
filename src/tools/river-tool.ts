// River tool — click to add control points along the ground, double-click or
// ESC to finish. Creates a RiverSpline entry. Rendered as a debug line strip
// until the Q9 spline ribbon mesh is wired up for visual rendering.

import { isMouseButtonPressed, isKeyPressed, getMouseX, getMouseY, getScreenWidth, getScreenHeight, MouseButton, Key, drawRay } from 'bloom';
import { RiverSpline, Vec3Lit } from 'bloom/world';
import { EditorState, Command, nextCounterId } from '../state/editor-state';
import { runCommand } from '../state/commands';
import { mouseToWorldRay, rayPlaneIntersect } from '../viewport/ray';

class AddRiverCommand implements Command {
  readonly label = 'Add river';
  private river: RiverSpline;

  constructor(river: RiverSpline) { this.river = river; }

  do(state: EditorState): void { state.world.rivers.push(this.river); }
  undo(state: EditorState): void {
    const idx = state.world.rivers.findIndex(r => r.id === this.river.id);
    if (idx >= 0) state.world.rivers.splice(idx, 1);
  }
}

interface RiverToolState {
  placing: boolean;
  points: Vec3Lit[];
  lastClickTime: number;
}

const toolState: RiverToolState = { placing: false, points: [], lastClickTime: 0 };

// Ids come from a world-metadata counter (survives restarts) with a
// collision guard against hand-authored ids.
function nextRiverId(state: EditorState): string {
  let id = nextCounterId(state, 'nextRiverId', 'river_');
  while (state.world.rivers.some(r => r.id === id)) {
    id = nextCounterId(state, 'nextRiverId', 'river_');
  }
  return id;
}

export function updateRiverTool(state: EditorState): void {
  if (state.activeTool !== 'river') {
    if (toolState.placing && toolState.points.length >= 2) {
      finishRiver(state);
    }
    toolState.placing = false;
    toolState.points = [];
    return;
  }

  const mx = getMouseX();
  const my = getMouseY();
  const inViewport = mx > state.viewportLeft && mx < state.viewportRight &&
                     my > state.viewportTop && my < state.viewportBottom;
  if (!inViewport) return;

  // ESC finishes the river.
  if (isKeyPressed(Key.ESCAPE) && toolState.placing && toolState.points.length >= 2) {
    finishRiver(state);
    toolState.placing = false;
    toolState.points = [];
    return;
  }

  if (isMouseButtonPressed(MouseButton.LEFT)) {
    const vw = state.viewportRight - state.viewportLeft;
    const vh = state.viewportBottom - state.viewportTop;
    const ray = mouseToWorldRay(state.camera, mx, my, getScreenWidth(), getScreenHeight(), state.viewportLeft, state.viewportTop, vw, vh);
    const ground = rayPlaneIntersect(ray, [0, 0, 0], [0, 1, 0]);
    if (!ground) return;

    // Double-click detection (within 400ms).
    const now = Date.now ? Date.now() : 0;
    if (toolState.placing && now - toolState.lastClickTime < 400 && toolState.points.length >= 2) {
      finishRiver(state);
      toolState.placing = false;
      toolState.points = [];
      return;
    }
    toolState.lastClickTime = now;

    toolState.placing = true;
    toolState.points.push([ground[0], ground[1], ground[2]]);
  }
}

function finishRiver(state: EditorState): void {
  const river: RiverSpline = {
    id: nextRiverId(state),
    controlPoints: toolState.points.slice(),
    widths: toolState.points.map(() => 2.0),
    depth: 1.0,
    flowSpeed: 1.0,
    color: [0.2, 0.4, 0.7, 0.7],
  };
  runCommand(state, new AddRiverCommand(river));
  state.modified = true;
}

export function drawRiverSplines(state: EditorState): void {
  for (let i = 0; i < state.world.rivers.length; i++) {
    const r = state.world.rivers[i];
    const pts = r.controlPoints;
    const c = { r: r.color[0] * 255, g: r.color[1] * 255, b: r.color[2] * 255, a: r.color[3] * 255 };
    for (let j = 0; j < pts.length - 1; j++) {
      drawRay(
        { x: pts[j][0], y: pts[j][1] + 0.1, z: pts[j][2] },
        { x: pts[j + 1][0] - pts[j][0], y: pts[j + 1][1] - pts[j][1], z: pts[j + 1][2] - pts[j][2] },
        c,
      );
    }
  }

  // Draw in-progress spline.
  if (toolState.placing && toolState.points.length >= 2) {
    for (let j = 0; j < toolState.points.length - 1; j++) {
      const a = toolState.points[j];
      const b = toolState.points[j + 1];
      drawRay(
        { x: a[0], y: a[1] + 0.1, z: a[2] },
        { x: b[0] - a[0], y: b[1] - a[1], z: b[2] - a[2] },
        { r: 100, g: 200, b: 255, a: 255 },
      );
    }
  }
}
