// Rotate gizmo: three colored circles drawn as immediate-mode rays arranged
// in arcs around each axis. Dragging along a circle rotates the entity.

import { drawRay, getMouseX, getMouseY, isMouseButtonDown, isMouseButtonPressed, isMouseButtonReleased, getScreenWidth, getScreenHeight, MouseButton } from 'bloom';
import { TransformData, Vec3Lit } from 'bloom/world';
import { EditorState, selectedEntityId } from '../state/editor-state';
import { TransformEntityCommand } from '../state/commands/transform-entity';
import { runCommand } from '../state/commands';
import { mouseToWorldRay, raySegmentDistance } from '../viewport/ray';
import { GizmoAxis, GIZMO_LENGTH, HIT_THRESHOLD, axisColor } from './gizmo-shared';

export interface RotateGizmoState {
  visible: boolean;
  dragging: boolean;
  dragAxis: GizmoAxis;
  dragStartAngle: number;
  dragStartTransform: TransformData | null;
  dragEntityId: string | null;
  anchor: Vec3Lit;
}

export function createRotateGizmoState(): RotateGizmoState {
  return {
    visible: false, dragging: false, dragAxis: null,
    dragStartAngle: 0, dragStartTransform: null, dragEntityId: null,
    anchor: [0, 0, 0],
  };
}

export function updateRotateGizmo(state: EditorState, gizmo: RotateGizmoState): void {
  if (state.playtesting || selectedEntityId(state) === null ||
      state.activeTool !== 'transform' || state.transformMode !== 'rotate') {
    gizmo.visible = false;
    gizmo.dragging = false;
    return;
  }

  const entity = state.world.entities.find(e => e.id === selectedEntityId(state));
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

  // Hit test: approximate each circle as 16 line segments, check ray distance.
  if (!gizmo.dragging && inViewport && isMouseButtonPressed(MouseButton.LEFT)) {
    const ray = mouseToWorldRay(state.camera, mx, my, sw, sh, state.viewportLeft, state.viewportTop, vw, vh);
    const pos = gizmo.anchor;
    const r = GIZMO_LENGTH;
    const segments = 16;

    let best: GizmoAxis = null;
    let bestDist = HIT_THRESHOLD * 2;

    const axes: GizmoAxis[] = ['x', 'y', 'z'];
    for (let ai = 0; ai < 3; ai++) {
      const axis = axes[ai];
      for (let s = 0; s < segments; s++) {
        const a0 = (s / segments) * Math.PI * 2;
        const a1 = ((s + 1) / segments) * Math.PI * 2;
        const p0 = circlePoint(pos, r, axis as 'x' | 'y' | 'z', a0);
        const p1 = circlePoint(pos, r, axis as 'x' | 'y' | 'z', a1);
        const hit = raySegmentDistance(ray, p0, p1);
        if (hit.dist < bestDist) { bestDist = hit.dist; best = axis; }
      }
    }

    if (best !== null) {
      gizmo.dragging = true;
      gizmo.dragAxis = best;
      gizmo.dragStartAngle = Math.atan2(my - sh / 2, mx - sw / 2);
      gizmo.dragStartTransform = cloneTransform(entity.transform);
      gizmo.dragEntityId = entity.id;
    }
  }

  if (gizmo.dragging) {
    if (isMouseButtonDown(MouseButton.LEFT)) {
      const angle = Math.atan2(my - sh / 2, mx - sw / 2);
      let delta = angle - gizmo.dragStartAngle;

      if (state.snap.rotate > 0) {
        const step = state.snap.rotate * Math.PI / 180;
        delta = Math.round(delta / step) * step;
      }

      const rot: Vec3Lit = [entity.transform.rotation[0], entity.transform.rotation[1], entity.transform.rotation[2]];
      if (gizmo.dragAxis === 'x') rot[0] = (gizmo.dragStartTransform as TransformData).rotation[0] + delta;
      else if (gizmo.dragAxis === 'y') rot[1] = (gizmo.dragStartTransform as TransformData).rotation[1] + delta;
      else rot[2] = (gizmo.dragStartTransform as TransformData).rotation[2] + delta;
      entity.transform.rotation = rot;
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

export function drawRotateGizmo(gizmo: RotateGizmoState): void {
  if (!gizmo.visible) return;
  const pos = gizmo.anchor;
  const r = GIZMO_LENGTH;
  const segments = 32;
  const axes: ('x' | 'y' | 'z')[] = ['x', 'y', 'z'];

  for (let ai = 0; ai < 3; ai++) {
    const axis = axes[ai];
    const color = axisColor(axis, gizmo.dragAxis === axis);
    for (let s = 0; s < segments; s++) {
      const a0 = (s / segments) * Math.PI * 2;
      const a1 = ((s + 1) / segments) * Math.PI * 2;
      const p0 = circlePoint(pos, r, axis, a0);
      const p1 = circlePoint(pos, r, axis, a1);
      drawRay(
        { x: p0[0], y: p0[1], z: p0[2] },
        { x: p1[0] - p0[0], y: p1[1] - p0[1], z: p1[2] - p0[2] },
        color,
      );
    }
  }
}

function circlePoint(center: Vec3Lit, radius: number, axis: 'x' | 'y' | 'z', angle: number): Vec3Lit {
  const c = Math.cos(angle) * radius;
  const s = Math.sin(angle) * radius;
  if (axis === 'x') return [center[0], center[1] + c, center[2] + s];
  if (axis === 'y') return [center[0] + c, center[1], center[2] + s];
  return [center[0] + c, center[1] + s, center[2]];
}

function cloneTransform(t: TransformData): TransformData {
  return { position: [t.position[0], t.position[1], t.position[2]], rotation: [t.rotation[0], t.rotation[1], t.rotation[2]], scale: [t.scale[0], t.scale[1], t.scale[2]] };
}
