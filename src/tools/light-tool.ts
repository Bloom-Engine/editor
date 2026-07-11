// Light tool — click on the ground to drop a point light.
//
// Lights are schema, not entities (world.lights), so they get their own tool
// rather than riding on the place tool's model catalog. Placed lights are lit
// for real in the viewport (see sync.ts → applyWorldLights); the wire marker
// drawn here is just so you can find and click one, since a light has no mesh.

import {
  isMouseButtonPressed, getMouseX, getMouseY, getScreenWidth, getScreenHeight,
  MouseButton, drawSphereWires,
} from 'bloom';
import { LightData, Vec3Lit } from 'bloom/world';
import { EditorState, Command, nextCounterId, selectLight } from '../state/editor-state';
import { runCommand } from '../state/commands';
import { mouseToWorldRay, rayPlaneIntersect } from '../viewport/ray';

// Defaults for a freshly placed light. A light at ground level is useless, so
// new ones start at head height.
export interface LightDefaults {
  height: number;
  color: Vec3Lit;
  intensity: number;
  range: number;
}

export const LIGHT_DEFAULTS: LightDefaults = {
  height: 3,
  color: [1.0, 0.9, 0.75],
  intensity: 1.0,
  range: 12,
};

export class AddLightCommand implements Command {
  readonly label = 'Add light';
  private light: LightData;

  constructor(light: LightData) { this.light = light; }

  do(state: EditorState): void {
    state.world.lights.push(this.light);
    selectLight(state, this.light.id);
  }

  undo(state: EditorState): void {
    const idx = state.world.lights.findIndex(l => l.id === this.light.id);
    if (idx >= 0) state.world.lights.splice(idx, 1);
    if (state.selection.kind === 'light' && state.selection.primary === this.light.id) {
      state.selection.primary = null;
      state.selection.kind = 'entity';
    }
  }
}

export class EditLightCommand implements Command {
  readonly label: string;
  readonly lightId: string;
  private before: LightData;
  private after: LightData;

  constructor(lightId: string, before: LightData, after: LightData) {
    this.lightId = lightId;
    this.before = cloneLight(before);
    this.after = cloneLight(after);
    this.label = 'Edit light ' + lightId;
  }

  do(state: EditorState): void { this.apply(state, this.after); }
  undo(state: EditorState): void { this.apply(state, this.before); }

  private apply(state: EditorState, value: LightData): void {
    for (let i = 0; i < state.world.lights.length; i++) {
      if (state.world.lights[i].id !== this.lightId) continue;
      state.world.lights[i] = cloneLight(value);
      return;
    }
  }

  // Coalesce a drag on the same light into one undo entry.
  mergeWith(next: Command): boolean {
    if (!(next instanceof EditLightCommand)) return false;
    const n = next as EditLightCommand;
    if (n.lightId !== this.lightId) return false;
    this.after = cloneLight(n.after);
    return true;
  }
}

export class RemoveLightCommand implements Command {
  readonly label: string;
  private light: LightData;
  private index: number;

  constructor(light: LightData, index: number) {
    this.light = cloneLight(light);
    this.index = index;
    this.label = 'Remove light ' + light.id;
  }

  do(state: EditorState): void {
    const idx = state.world.lights.findIndex(l => l.id === this.light.id);
    if (idx >= 0) state.world.lights.splice(idx, 1);
    if (state.selection.kind === 'light' && state.selection.primary === this.light.id) {
      state.selection.primary = null;
      state.selection.kind = 'entity';
    }
  }

  undo(state: EditorState): void {
    // Restore at the original index so the file's ordering round-trips.
    state.world.lights.splice(this.index, 0, cloneLight(this.light));
  }
}

export function cloneLight(l: LightData): LightData {
  return {
    id: l.id,
    name: l.name,
    kind: l.kind,
    position: [l.position[0], l.position[1], l.position[2]],
    color: [l.color[0], l.color[1], l.color[2]],
    intensity: l.intensity,
    range: l.range,
  };
}

export function updateLightTool(state: EditorState): void {
  if (state.activeTool !== 'light') return;

  const mx = getMouseX();
  const my = getMouseY();
  const inViewport = mx > state.viewportLeft && mx < state.viewportRight &&
                     my > state.viewportTop && my < state.viewportBottom;
  if (!inViewport) return;
  if (!isMouseButtonPressed(MouseButton.LEFT)) return;

  const vw = state.viewportRight - state.viewportLeft;
  const vh = state.viewportBottom - state.viewportTop;
  const ray = mouseToWorldRay(state.camera, mx, my, getScreenWidth(), getScreenHeight(), state.viewportLeft, state.viewportTop, vw, vh);
  const ground = rayPlaneIntersect(ray, [0, 0, 0], [0, 1, 0]);
  if (!ground) return;

  const d = LIGHT_DEFAULTS;
  const id = nextLightId(state);
  const light: LightData = {
    id: id,
    name: id,
    kind: 'point',
    position: [ground[0], ground[1] + d.height, ground[2]],
    color: [d.color[0], d.color[1], d.color[2]],
    intensity: d.intensity,
    range: d.range,
  };

  runCommand(state, new AddLightCommand(light));
  state.modified = true;
}

function nextLightId(state: EditorState): string {
  let id = nextCounterId(state, 'nextLightId', 'light_');
  while (state.world.lights.some(l => l.id === id)) {
    id = nextCounterId(state, 'nextLightId', 'light_');
  }
  return id;
}

// A light has no geometry, so draw a marker: a small sphere at the light, and a
// wire sphere at its range when selected, so "how far does this reach" is
// answerable without doing arithmetic on the inspector numbers.
export function drawLightMarkers(state: EditorState): void {
  for (let i = 0; i < state.world.lights.length; i++) {
    const l = state.world.lights[i];
    const selected = state.selection.kind === 'light' && state.selection.primary === l.id;
    const pos = { x: l.position[0], y: l.position[1], z: l.position[2] };
    const tint = {
      r: Math.floor(l.color[0] * 255),
      g: Math.floor(l.color[1] * 255),
      b: Math.floor(l.color[2] * 255),
      a: 255,
    };

    drawSphereWires(pos, 0.25, tint);
    if (selected) {
      drawSphereWires(pos, l.range, { r: tint.r, g: tint.g, b: tint.b, a: 90 });
    }
  }
}
