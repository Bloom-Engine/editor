// Point gizmo — axis-drag movement for the non-entity selectables: water
// volumes (move center / scale size), river control points, and lights
// (PLAN §C tail). The entity gizmos bail on these selections by design
// (selectedEntityId returns null), so without this the only way to move a
// river bend or a light was typing numbers into the inspector.
//
// Same axis-ray drag math as move-gizmo.ts; commits through the existing
// EditWaterCommand / EditRiverCommand / EditLightCommand on release, so a
// whole drag is one undo entry (their mergeWith handles inspector drags the
// same way).

import {
  getMouseX, getMouseY, isMouseButtonPressed, isMouseButtonDown,
  getScreenWidth, getScreenHeight, MouseButton,
  drawRay, drawSphereWires,
} from 'bloom';
import { WaterVolume, RiverSpline, LightData, Vec3Lit } from 'bloom/world';
import { EditorState } from '../state/editor-state';
import { runCommand } from '../state/commands';
import { EditWaterCommand, EditRiverCommand } from '../state/commands/edit-water';
import { EditLightCommand, cloneLight } from '../tools/light-tool';
import { mouseToWorldRay, raySegmentDistance, Ray3 } from '../viewport/ray';

const GIZMO_LENGTH = 2.5;
const HIT_THRESHOLD = 0.15;
const POINT_HIT_RADIUS = 0.6;   // Click distance for river control points.

type Axis = 'x' | 'y' | 'z' | null;

export interface PointGizmoState {
  visible: boolean;
  dragging: boolean;
  // True for one frame when a click landed on a river handle — main.ts must
  // not ALSO route that click to handleSelectClick, which would deselect.
  consumedClick: boolean;
  dragAxis: Axis;
  // What the drag is editing. Only one of the before* fields is non-null.
  targetKind: 'water' | 'river' | 'light' | null;
  targetId: string | null;
  activePointIdx: number;           // River control point index; 0 otherwise.
  beforeWater: WaterVolume | null;
  beforeRiver: RiverSpline | null;
  beforeLight: LightData | null;
  // Scale-mode drag bookkeeping (water size).
  dragStartAxisValue: number;
  dragStartSize: Vec3Lit;
  anchor: Vec3Lit;
  scaleMode: boolean;
  lastTargetId: string | null;      // Reset activePointIdx on selection change.
}

export function createPointGizmoState(): PointGizmoState {
  return {
    visible: false, dragging: false, consumedClick: false, dragAxis: null,
    targetKind: null, targetId: null, activePointIdx: 0,
    beforeWater: null, beforeRiver: null, beforeLight: null,
    dragStartAxisValue: 0, dragStartSize: [0, 0, 0],
    anchor: [0, 0, 0], scaleMode: false, lastTargetId: null,
  };
}

function cloneWater(w: WaterVolume): WaterVolume {
  return {
    id: w.id, kind: w.kind,
    center: [w.center[0], w.center[1], w.center[2]],
    size: [w.size[0], w.size[1], w.size[2]],
    surfaceHeight: w.surfaceHeight,
    color: [w.color[0], w.color[1], w.color[2], w.color[3]],
    waveAmplitude: w.waveAmplitude, waveSpeed: w.waveSpeed,
  };
}

function cloneRiver(r: RiverSpline): RiverSpline {
  const pts: [number, number, number][] = [];
  for (let i = 0; i < r.controlPoints.length; i++) {
    const p = r.controlPoints[i];
    pts.push([p[0], p[1], p[2]]);
  }
  return {
    id: r.id, controlPoints: pts, widths: r.widths.slice(),
    depth: r.depth, flowSpeed: r.flowSpeed,
    color: [r.color[0], r.color[1], r.color[2], r.color[3]],
  };
}

// Distance from a ray to a point, via a degenerate-safe tiny segment.
function rayPointDistance(ray: Ray3, p: Vec3Lit): number {
  return raySegmentDistance(ray, [p[0], p[1] - 0.001, p[2]], [p[0], p[1] + 0.001, p[2]]).dist;
}

export function updatePointGizmo(state: EditorState, gizmo: PointGizmoState): void {
  gizmo.visible = false;
  gizmo.consumedClick = false;

  if (state.playtesting || state.activeTool !== 'transform') {
    gizmo.dragging = false;
    return;
  }

  const kind = state.selection.kind;
  const id = state.selection.primary;
  if (id === null || (kind !== 'water' && kind !== 'river' && kind !== 'light')) {
    gizmo.dragging = false;
    return;
  }

  // Rotation is meaningless for all three; scale only applies to water.
  const scaleMode = state.transformMode === 'scale';
  if (state.transformMode === 'rotate') return;
  if (scaleMode && kind !== 'water') return;

  if (gizmo.lastTargetId !== id) {
    gizmo.lastTargetId = id;
    gizmo.activePointIdx = 0;
    gizmo.dragging = false;
  }

  // Resolve the target + anchor.
  const water = kind === 'water' ? state.world.water.find(w => w.id === id) : undefined;
  const river = kind === 'river' ? state.world.rivers.find(r => r.id === id) : undefined;
  const light = kind === 'light' ? state.world.lights.find(l => l.id === id) : undefined;
  if (!water && !river && !light) return;

  if (water) gizmo.anchor = [water.center[0], water.center[1], water.center[2]];
  if (river) {
    if (gizmo.activePointIdx >= river.controlPoints.length) gizmo.activePointIdx = 0;
    const p = river.controlPoints[gizmo.activePointIdx];
    gizmo.anchor = [p[0], p[1], p[2]];
  }
  if (light) gizmo.anchor = [light.position[0], light.position[1], light.position[2]];

  gizmo.visible = true;
  gizmo.targetKind = kind;
  gizmo.targetId = id;
  gizmo.scaleMode = scaleMode;

  const mx = getMouseX();
  const my = getMouseY();
  const inViewport = mx > state.viewportLeft && mx < state.viewportRight &&
                     my > state.viewportTop && my < state.viewportBottom;
  const vw = state.viewportRight - state.viewportLeft;
  const vh = state.viewportBottom - state.viewportTop;
  const sw = getScreenWidth();
  const sh = getScreenHeight();

  // ---- click: river point pick first, then axis pick ------------------------

  if (!gizmo.dragging && inViewport && isMouseButtonPressed(MouseButton.LEFT)) {
    const ray = mouseToWorldRay(state.camera, mx, my, sw, sh, state.viewportLeft, state.viewportTop, vw, vh);

    // Clicking a river control point makes it the active handle.
    if (river) {
      let bestIdx = -1;
      let bestDist = POINT_HIT_RADIUS;
      for (let i = 0; i < river.controlPoints.length; i++) {
        const d = rayPointDistance(ray, river.controlPoints[i]);
        if (d < bestDist) { bestDist = d; bestIdx = i; }
      }
      if (bestIdx >= 0 && bestIdx !== gizmo.activePointIdx) {
        gizmo.activePointIdx = bestIdx;
        const p = river.controlPoints[bestIdx];
        gizmo.anchor = [p[0], p[1], p[2]];
        gizmo.consumedClick = true;
        return; // Selecting the handle is this click's whole job.
      }
    }

    const pos = gizmo.anchor;
    const hitX = raySegmentDistance(ray, pos, [pos[0] + GIZMO_LENGTH, pos[1], pos[2]]);
    const hitY = raySegmentDistance(ray, pos, [pos[0], pos[1] + GIZMO_LENGTH, pos[2]]);
    const hitZ = raySegmentDistance(ray, pos, [pos[0], pos[1], pos[2] + GIZMO_LENGTH]);

    let best: Axis = null;
    let bestDist = HIT_THRESHOLD;
    if (hitX.dist < bestDist) { bestDist = hitX.dist; best = 'x'; }
    if (hitY.dist < bestDist) { bestDist = hitY.dist; best = 'y'; }
    if (hitZ.dist < bestDist) { bestDist = hitZ.dist; best = 'z'; }

    if (best !== null) {
      gizmo.dragging = true;
      gizmo.dragAxis = best;
      gizmo.beforeWater = water ? cloneWater(water) : null;
      gizmo.beforeRiver = river ? cloneRiver(river) : null;
      gizmo.beforeLight = light ? cloneLight(light) : null;
      if (water && scaleMode) {
        gizmo.dragStartSize = [water.size[0], water.size[1], water.size[2]];
        let ai = 2;
        if (best === 'x') ai = 0;
        else if (best === 'y') ai = 1;
        gizmo.dragStartAxisValue = gizmo.anchor[ai];
      }
    }
  }

  // ---- drag ------------------------------------------------------------------

  if (gizmo.dragging) {
    if (isMouseButtonDown(MouseButton.LEFT)) {
      const ray = mouseToWorldRay(state.camera, mx, my, sw, sh, state.viewportLeft, state.viewportTop, vw, vh);
      const axis = gizmo.dragAxis;
      let ai = 2;
      let axisVec: Vec3Lit = [0, 0, 1];
      if (axis === 'x') { ai = 0; axisVec = [1, 0, 0]; }
      else if (axis === 'y') { ai = 1; axisVec = [0, 1, 0]; }
      const pos = gizmo.anchor;

      const endOnAxis = raySegmentDistance(ray,
        [pos[0] - axisVec[0] * 50, pos[1] - axisVec[1] * 50, pos[2] - axisVec[2] * 50],
        [pos[0] + axisVec[0] * 50, pos[1] + axisVec[1] * 50, pos[2] + axisVec[2] * 50],
      );
      let v = endOnAxis.point[ai];
      if (!gizmo.scaleMode && state.snap.translate > 0) {
        v = Math.round(v / state.snap.translate) * state.snap.translate;
      }

      if (water) {
        if (gizmo.scaleMode) {
          // Dragging the handle outward grows the box symmetrically.
          let ns = gizmo.dragStartSize[ai] + (v - gizmo.dragStartAxisValue) * 2;
          if (ns < 0.1) ns = 0.1;
          water.size[ai] = ns;
        } else {
          water.center[ai] = v;
        }
        state.pendingWaterRebuild = true;
      } else if (river) {
        river.controlPoints[gizmo.activePointIdx][ai] = v;
        state.pendingWaterRebuild = true;
      } else if (light) {
        light.position[ai] = v;   // Lights re-apply every frame from world data.
      }
      state.modified = true;
    } else {
      // Release — commit the whole drag as one undoable command.
      if (water && gizmo.beforeWater) {
        runCommand(state, new EditWaterCommand(water.id, gizmo.beforeWater, water));
      } else if (river && gizmo.beforeRiver) {
        runCommand(state, new EditRiverCommand(river.id, gizmo.beforeRiver, river));
      } else if (light && gizmo.beforeLight) {
        runCommand(state, new EditLightCommand(light.id, gizmo.beforeLight, light));
      }
      gizmo.dragging = false;
      gizmo.dragAxis = null;
      gizmo.beforeWater = null;
      gizmo.beforeRiver = null;
      gizmo.beforeLight = null;
    }
  }
}

// Draw between beginMode3D / endMode3D.
export function drawPointGizmo(state: EditorState, gizmo: PointGizmoState): void {
  if (!gizmo.visible) return;

  // River control points render as wire spheres; the active one is larger and
  // amber, so "which point am I about to drag" is never a guess.
  if (gizmo.targetKind === 'river' && gizmo.targetId !== null) {
    const river = state.world.rivers.find(r => r.id === gizmo.targetId);
    if (river) {
      for (let i = 0; i < river.controlPoints.length; i++) {
        const p = river.controlPoints[i];
        if (i === gizmo.activePointIdx) {
          drawSphereWires({ x: p[0], y: p[1], z: p[2] }, 0.35, { r: 255, g: 210, b: 60, a: 255 });
        } else {
          drawSphereWires({ x: p[0], y: p[1], z: p[2] }, 0.22, { r: 120, g: 190, b: 255, a: 220 });
        }
      }
    }
  }

  const pos = gizmo.anchor;
  drawRay({ x: pos[0], y: pos[1], z: pos[2] }, { x: GIZMO_LENGTH, y: 0, z: 0 },
    { r: 220, g: 60, b: 60, a: gizmo.dragAxis === 'x' ? 255 : 200 });
  drawRay({ x: pos[0], y: pos[1], z: pos[2] }, { x: 0, y: GIZMO_LENGTH, z: 0 },
    { r: 60, g: 200, b: 60, a: gizmo.dragAxis === 'y' ? 255 : 200 });
  drawRay({ x: pos[0], y: pos[1], z: pos[2] }, { x: 0, y: 0, z: GIZMO_LENGTH },
    { r: 60, g: 100, b: 240, a: gizmo.dragAxis === 'z' ? 255 : 200 });
}
