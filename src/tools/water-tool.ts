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

  do(state: EditorState): void { state.world.water.push(this.volume); }
  undo(state: EditorState): void {
    const idx = state.world.water.findIndex(w => w.id === this.volume.id);
    if (idx >= 0) state.world.water.splice(idx, 1);
  }
}

interface WaterToolState {
  placing: boolean;
  startPoint: Vec3Lit | null;
}

const toolState: WaterToolState = { placing: false, startPoint: null };

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
      const volume: WaterVolume = {
        id: nextWaterId(state),
        kind: 'box',
        center: [cx, 0, cz],
        size: [sx, 2, sz],
        surfaceHeight: 0.5,
        color: [0.2, 0.5, 0.8, 0.6],
        waveAmplitude: 0.1,
        waveSpeed: 1.0,
      };
      runCommand(state, new AddWaterCommand(volume));
      state.modified = true;
    }
    toolState.placing = false;
    toolState.startPoint = null;
  }
}

export function drawWaterVolumes(state: EditorState): void {
  for (let i = 0; i < state.world.water.length; i++) {
    const w = state.world.water[i];
    const c = w.color;
    drawCube(
      { x: w.center[0], y: w.surfaceHeight, z: w.center[2] },
      w.size[0], w.size[1], w.size[2],
      { r: c[0] * 255, g: c[1] * 255, b: c[2] * 255, a: c[3] * 255 },
    );
  }
}
