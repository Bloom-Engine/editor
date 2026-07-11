// Scale gizmo: three colored axis handles (small cubes at the end of each axis)
// plus a center cube for uniform scale. Dragging an axis handle scales on that
// axis only; dragging the center scales uniformly.

import { drawRay, drawCube, getMouseX, getMouseY, isMouseButtonDown, isMouseButtonPressed, getScreenWidth, getScreenHeight, MouseButton } from 'bloom';
import { TransformData, Vec3Lit } from 'bloom/world';
import { EditorState } from '../state/editor-state';
import { TransformEntityCommand } from '../state/commands/transform-entity';
import { runCommand } from '../state/commands';
import { mouseToWorldRay, raySegmentDistance } from '../viewport/ray';
import { GizmoAxis, GIZMO_LENGTH, HIT_THRESHOLD, axisColor } from './gizmo-shared';

export interface ScaleGizmoState {
  visible: boolean;
  dragging: boolean;
  dragAxis: GizmoAxis | 'uniform';
  dragStartX: number;
  dragStartTransform: TransformData | null;
  dragEntityId: string | null;
  anchor: Vec3Lit;
}

export function createScaleGizmoState(): ScaleGizmoState {
  return {
    visible: false, dragging: false, dragAxis: null,
    dragStartX: 0, dragStartTransform: null, dragEntityId: null,
    anchor: [0, 0, 0],
  };
}

export function updateScaleGizmo(state: EditorState, gizmo: ScaleGizmoState): void {
  if (state.playtesting || state.selection.primary === null ||
      state.activeTool !== 'transform' || state.transformMode !== 'scale') {
    gizmo.visible = false;
    gizmo.dragging = false;
    return;
  }

  const entity = state.world.entities.find(e => e.id === state.selection.primary);
  if (!entity) { gizmo.visible = false; return; }

  gizmo.visible = true;
  gizmo.anchor = [entity.transform.position[0], entity.transform.position[1], entity.transform.position[2]];

  const mx = getMouseX();
  const my = getMouseY();
  const inViewport = mx > state.viewportLeft && mx < state.viewportRight &&
                     my > state.viewportTop && my < state.viewportBottom;
  const vw = state.viewportRight - state.viewportLeft;
  const vh = state.viewportBottom - state.viewportTop;
  const sw = getScreenWidth();
  const sh = getScreenHeight();

  if (!gizmo.dragging && inViewport && isMouseButtonPressed(MouseButton.LEFT)) {
    const ray = mouseToWorldRay(state.camera, mx, my, sw, sh, state.viewportLeft, state.viewportTop, vw, vh);
    const pos = gizmo.anchor;
    const len = GIZMO_LENGTH;

    // Hit test axis handles (end of each axis line).
    const hitX = raySegmentDistance(ray, [pos[0] + len - 0.2, pos[1], pos[2]], [pos[0] + len + 0.2, pos[1], pos[2]]);
    const hitY = raySegmentDistance(ray, [pos[0], pos[1] + len - 0.2, pos[2]], [pos[0], pos[1] + len + 0.2, pos[2]]);
    const hitZ = raySegmentDistance(ray, [pos[0], pos[1], pos[2] + len - 0.2], [pos[0], pos[1], pos[2] + len + 0.2]);
    // Center cube.
    const hitC = raySegmentDistance(ray, [pos[0] - 0.2, pos[1] - 0.2, pos[2] - 0.2], [pos[0] + 0.2, pos[1] + 0.2, pos[2] + 0.2]);

    let best: GizmoAxis | 'uniform' = null;
    let bestDist = HIT_THRESHOLD * 2;

    if (hitX.dist < bestDist) { bestDist = hitX.dist; best = 'x'; }
    if (hitY.dist < bestDist) { bestDist = hitY.dist; best = 'y'; }
    if (hitZ.dist < bestDist) { bestDist = hitZ.dist; best = 'z'; }
    if (hitC.dist < bestDist) { bestDist = hitC.dist; best = 'uniform'; }

    if (best !== null) {
      gizmo.dragging = true;
      gizmo.dragAxis = best;
      gizmo.dragStartX = mx;
      gizmo.dragStartTransform = cloneTransform(entity.transform);
      gizmo.dragEntityId = entity.id;
    }
  }

  if (gizmo.dragging) {
    if (isMouseButtonDown(MouseButton.LEFT)) {
      const delta = (mx - gizmo.dragStartX) * 0.01;
      const startScl = (gizmo.dragStartTransform as TransformData).scale;
      const scl: Vec3Lit = [startScl[0], startScl[1], startScl[2]];

      if (gizmo.dragAxis === 'uniform') {
        const factor = 1 + delta;
        scl[0] = startScl[0] * factor;
        scl[1] = startScl[1] * factor;
        scl[2] = startScl[2] * factor;
      } else if (gizmo.dragAxis === 'x') {
        scl[0] = startScl[0] + delta;
      } else if (gizmo.dragAxis === 'y') {
        scl[1] = startScl[1] + delta;
      } else if (gizmo.dragAxis === 'z') {
        scl[2] = startScl[2] + delta;
      }

      // Clamp to prevent negative scale.
      if (scl[0] < 0.01) scl[0] = 0.01;
      if (scl[1] < 0.01) scl[1] = 0.01;
      if (scl[2] < 0.01) scl[2] = 0.01;

      if (state.snap.scale > 0) {
        const s = state.snap.scale;
        scl[0] = Math.round(scl[0] / s) * s;
        scl[1] = Math.round(scl[1] / s) * s;
        scl[2] = Math.round(scl[2] / s) * s;
      }

      entity.transform.scale = scl;
      state.pendingRebuild.add(entity.id);
    } else {
      if (gizmo.dragStartTransform && gizmo.dragEntityId) {
        runCommand(state, new TransformEntityCommand(gizmo.dragEntityId, gizmo.dragStartTransform, entity.transform));
      }
      gizmo.dragging = false;
      gizmo.dragAxis = null;
    }
  }
}

export function drawScaleGizmo(gizmo: ScaleGizmoState): void {
  if (!gizmo.visible) return;
  const pos = gizmo.anchor;
  const len = GIZMO_LENGTH;

  // Axis lines (thinner than move gizmo arrows).
  drawRay({ x: pos[0], y: pos[1], z: pos[2] }, { x: len, y: 0, z: 0 }, axisColor('x', gizmo.dragAxis === 'x'));
  drawRay({ x: pos[0], y: pos[1], z: pos[2] }, { x: 0, y: len, z: 0 }, axisColor('y', gizmo.dragAxis === 'y'));
  drawRay({ x: pos[0], y: pos[1], z: pos[2] }, { x: 0, y: 0, z: len }, axisColor('z', gizmo.dragAxis === 'z'));

  // Small cubes at the end of each axis.
  const s = 0.15;
  drawCube({ x: pos[0] + len, y: pos[1], z: pos[2] }, s, s, s, axisColor('x', gizmo.dragAxis === 'x'));
  drawCube({ x: pos[0], y: pos[1] + len, z: pos[2] }, s, s, s, axisColor('y', gizmo.dragAxis === 'y'));
  drawCube({ x: pos[0], y: pos[1], z: pos[2] + len }, s, s, s, axisColor('z', gizmo.dragAxis === 'z'));

  // Center cube for uniform scale.
  const uc = gizmo.dragAxis === 'uniform'
    ? { r: 255, g: 255, b: 255, a: 255 }
    : { r: 180, g: 180, b: 180, a: 200 };
  drawCube({ x: pos[0], y: pos[1], z: pos[2] }, s * 1.5, s * 1.5, s * 1.5, uc);
}

function cloneTransform(t: TransformData): TransformData {
  return { position: [t.position[0], t.position[1], t.position[2]], rotation: [t.rotation[0], t.rotation[1], t.rotation[2]], scale: [t.scale[0], t.scale[1], t.scale[2]] };
}
