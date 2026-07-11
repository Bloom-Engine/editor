// Water tool — click and drag in the viewport to define an axis-aligned box,
// then drag upward to set the water surface height. Creates a WaterVolume
// entry in the world data. Rendered as a translucent cube in the viewport
// (the animated water shader Q8 replaces this with proper waves later).

import { isMouseButtonPressed, isMouseButtonDown, isMouseButtonReleased, getMouseX, getMouseY, getScreenWidth, getScreenHeight, MouseButton, drawCube } from 'bloom';
import { WaterVolume, Vec3Lit, Vec4Lit } from 'bloom/world';
import { EditorState, Command, nextCounterId } from '../state/editor-state';
import { runCommand } from '../state/commands';
import { mouseToWorldRay, rayPlaneIntersect } from '../viewport/ray';

class AddWaterCommand implements Command {
  readonly label = 'Add water volume';
  private volume: WaterVolume;

  constructor(volume: WaterVolume) { this.volume = volume; }

  do(state: EditorState): void {
    state.world.water.push(this.volume);
    state.pendingWaterRebuild = true;
  }
  undo(state: EditorState): void {
    const idx = state.world.water.findIndex(w => w.id === this.volume.id);
    if (idx >= 0) state.world.water.splice(idx, 1);
    state.pendingWaterRebuild = true;
  }
}

interface WaterToolState {
  placing: boolean;
  startPoint: Vec3Lit | null;
}

const toolState: WaterToolState = { placing: false, startPoint: null };

// Defaults for a newly dragged-out volume. Exported so the water panel can
// edit them before placement — previously these were frozen constants inline,
// so every volume came out the same shade of blue at the same height.
export interface WaterDefaults {
  surfaceHeight: number;
  depth: number;                       // Box height below the surface.
  color: Vec4Lit;
  waveAmplitude: number;
  waveSpeed: number;
}

export const WATER_DEFAULTS: WaterDefaults = {
  surfaceHeight: 0.5,
  depth: 2,
  color: [0.2, 0.5, 0.8, 0.6],
  waveAmplitude: 0.1,
  waveSpeed: 1.0,
};

// Ids come from a world-metadata counter (survives restarts), with a guard
// against collisions with hand-authored ids like arena_02's "river".
function nextWaterId(state: EditorState): string {
  let id = nextCounterId(state, 'nextWaterId', 'water_');
  while (state.world.water.some(w => w.id === id)) {
    id = nextCounterId(state, 'nextWaterId', 'water_');
  }
  return id;
}

export function updateWaterTool(state: EditorState): void {
  if (state.activeTool !== 'water') {
    toolState.placing = false;
    return;
  }

  const mx = getMouseX();
  const my = getMouseY();
  const inViewport = mx > state.viewportLeft && mx < state.viewportRight &&
                     my > state.viewportTop && my < state.viewportBottom;
  if (!inViewport) return;

  const vw = state.viewportRight - state.viewportLeft;
  const vh = state.viewportBottom - state.viewportTop;
  const ray = mouseToWorldRay(state.camera, mx, my, getScreenWidth(), getScreenHeight(), state.viewportLeft, state.viewportTop, vw, vh);
  const ground = rayPlaneIntersect(ray, [0, 0, 0], [0, 1, 0]);
  if (!ground) return;

  if (isMouseButtonPressed(MouseButton.LEFT)) {
    toolState.placing = true;
    toolState.startPoint = [ground[0], ground[1], ground[2]];
  }

  if (toolState.placing && isMouseButtonReleased(MouseButton.LEFT) && toolState.startPoint) {
    const sp = toolState.startPoint;
    const cx = (sp[0] + ground[0]) / 2;
    const cz = (sp[2] + ground[2]) / 2;
    const sx = Math.abs(ground[0] - sp[0]);
    const sz = Math.abs(ground[2] - sp[2]);
    if (sx > 0.5 && sz > 0.5) {
      const d = WATER_DEFAULTS;
      const volume: WaterVolume = {
        id: nextWaterId(state),
        kind: 'box',
        center: [cx, d.surfaceHeight - d.depth / 2, cz],
        size: [sx, d.depth, sz],
        surfaceHeight: d.surfaceHeight,
        color: [d.color[0], d.color[1], d.color[2], d.color[3]],
        waveAmplitude: d.waveAmplitude,
        waveSpeed: d.waveSpeed,
      };
      runCommand(state, new AddWaterCommand(volume));
      state.modified = true;
    }
    toolState.placing = false;
    toolState.startPoint = null;
  }
}

// Placed volumes are real scene nodes with the animated water material (see
// world-sync/sync.ts → the engine's shared spawnWaterVolume). All this draws is
// the rubber-band preview while the user is dragging one out.
export function drawWaterVolumes(state: EditorState): void {
  if (!toolState.placing || !toolState.startPoint) return;

  const mx = getMouseX();
  const my = getMouseY();
  const vw = state.viewportRight - state.viewportLeft;
  const vh = state.viewportBottom - state.viewportTop;
  const ray = mouseToWorldRay(state.camera, mx, my, getScreenWidth(), getScreenHeight(), state.viewportLeft, state.viewportTop, vw, vh);
  const ground = rayPlaneIntersect(ray, [0, 0, 0], [0, 1, 0]);
  if (!ground) return;

  const sp = toolState.startPoint;
  const cx = (sp[0] + ground[0]) / 2;
  const cz = (sp[2] + ground[2]) / 2;
  const sx = Math.abs(ground[0] - sp[0]);
  const sz = Math.abs(ground[2] - sp[2]);
  if (sx < 0.01 || sz < 0.01) return;

  drawCube(
    { x: cx, y: WATER_DEFAULTS.surfaceHeight, z: cz },
    sx, 0.05, sz,
    { r: 90, g: 170, b: 230, a: 140 },
  );
}
