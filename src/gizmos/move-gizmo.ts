// Move gizmo: three colored axis arrows drawn as scene nodes. The editor
// renders these at the selected entity's position and hit-tests them via
// ray-segment distance (depth-independent, §6 of the plan).
//
// The gizmo creates 3 scene nodes once at init and reuses them every frame.
// Each arrow = a thin elongated box (shaft) — the engine's scene graph
// doesn't support custom line geometry easily, so we approximate with cubes
// scaled to thin rectangles. This is visually sufficient.

import {
  createSceneNode, destroySceneNode,
  setSceneNodeTransform, setSceneNodeColor, setSceneNodeVisible,
  updateSceneNodeGeometry,
} from 'bloom/scene';
import { mat4Identity, mat4Translate, mat4Scale } from 'bloom';
import { EditorState, handleOfEntity } from '../state/editor-state';
import { TransformEntityCommand } from '../state/commands/transform-entity';
import { runCommand } from '../state/commands';
import { mouseToWorldRay, raySegmentDistance, Ray3 } from '../viewport/ray';
import {
  getMouseX, getMouseY, isMouseButtonPressed, isMouseButtonDown,
  isMouseButtonReleased, getScreenWidth, getScreenHeight, MouseButton,
} from 'bloom';
import { TransformData, Vec3Lit } from 'bloom/world';

const GIZMO_LENGTH = 2.5;
const HIT_THRESHOLD = 0.15; // World-space distance threshold for axis pick.

export interface MoveGizmoState {
  initialized: boolean;
  visible: boolean;
  // Drag state.
  dragging: boolean;
  dragAxis: 'x' | 'y' | 'z' | null;
  dragStartPos: Vec3Lit;
  dragStartTransform: TransformData | null;
  dragEntityId: string | null;
  // The world-space position where the gizmo is anchored.
  anchor: Vec3Lit;
}

export function createMoveGizmoState(): MoveGizmoState {
  return {
    initialized: false,
    visible: false,
    dragging: false,
    dragAxis: null,
    dragStartPos: [0, 0, 0],
    dragStartTransform: null,
    dragEntityId: null,
    anchor: [0, 0, 0],
  };
}

// Per-frame update. Call between beginMode3D and endMode3D.
export function updateMoveGizmo(state: EditorState, gizmo: MoveGizmoState): void {
  if (state.playtesting) {
    gizmo.visible = false;
    return;
  }

  // Position the gizmo at the selected entity.
  if (state.selection.primary === null || state.activeTool !== 'transform' || state.transformMode !== 'move') {
    gizmo.visible = false;
    gizmo.dragging = false;
    return;
  }

  const entity = state.world.entities.find(e => e.id === state.selection.primary);
  if (!entity) {
    gizmo.visible = false;
    gizmo.dragging = false;
    return;
  }

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

  // ---- hit test gizmo axes -------------------------------------------------

  if (!gizmo.dragging && inViewport && isMouseButtonPressed(MouseButton.LEFT)) {
    const ray = mouseToWorldRay(state.camera, mx, my, sw, sh, state.viewportLeft, state.viewportTop, vw, vh);
    const pos = gizmo.anchor;

    const hitX = raySegmentDistance(ray, pos, [pos[0] + GIZMO_LENGTH, pos[1], pos[2]]);
    const hitY = raySegmentDistance(ray, pos, [pos[0], pos[1] + GIZMO_LENGTH, pos[2]]);
    const hitZ = raySegmentDistance(ray, pos, [pos[0], pos[1], pos[2] + GIZMO_LENGTH]);

    let best: 'x' | 'y' | 'z' | null = null;
    let bestDist = HIT_THRESHOLD;

    if (hitX.dist < bestDist) { bestDist = hitX.dist; best = 'x'; }
    if (hitY.dist < bestDist) { bestDist = hitY.dist; best = 'y'; }
    if (hitZ.dist < bestDist) { bestDist = hitZ.dist; best = 'z'; }

    if (best !== null) {
      gizmo.dragging = true;
      gizmo.dragAxis = best;
      gizmo.dragStartPos = [entity.transform.position[0], entity.transform.position[1], entity.transform.position[2]];
      gizmo.dragStartTransform = {
        position: [entity.transform.position[0], entity.transform.position[1], entity.transform.position[2]],
        rotation: [entity.transform.rotation[0], entity.transform.rotation[1], entity.transform.rotation[2]],
        scale: [entity.transform.scale[0], entity.transform.scale[1], entity.transform.scale[2]],
      };
      gizmo.dragEntityId = entity.id;
    }
  }

  // ---- drag in progress ----------------------------------------------------

  if (gizmo.dragging) {
    if (isMouseButtonDown(MouseButton.LEFT)) {
      const ray = mouseToWorldRay(state.camera, mx, my, sw, sh, state.viewportLeft, state.viewportTop, vw, vh);
      const axis = gizmo.dragAxis;
      const startPos = gizmo.dragStartPos;

      // Project the current mouse ray onto the drag axis to find the new position.
      // We use ray-plane intersection where the plane contains the drag axis
      // and is perpendicular to the best-fitting view direction.
      let axisVec: Vec3Lit = [0, 0, 0];
      if (axis === 'x') axisVec = [1, 0, 0];
      else if (axis === 'y') axisVec = [0, 1, 0];
      else axisVec = [0, 0, 1];

      // Simple drag: project mouse delta onto the axis direction in screen space.
      // More robust than full ray-plane math, and works even for oblique views.
      const mdx = getMouseX() - mx; // 0 within a frame; see alternative below.

      // Alternative: use the camera's eye direction to build a plane.
      // For now, use the distance from the ray to the axis as a parametric
      // delta on the axis. This works cleanly:
      const endOnAxis = raySegmentDistance(ray,
        [startPos[0] - axisVec[0] * 50, startPos[1] - axisVec[1] * 50, startPos[2] - axisVec[2] * 50],
        [startPos[0] + axisVec[0] * 50, startPos[1] + axisVec[1] * 50, startPos[2] + axisVec[2] * 50],
      );
      // endOnAxis.point is the closest point on the axis to the current ray.
      const newPos: Vec3Lit = [entity.transform.position[0], entity.transform.position[1], entity.transform.position[2]];
      if (axis === 'x') newPos[0] = endOnAxis.point[0];
      else if (axis === 'y') newPos[1] = endOnAxis.point[1];
      else newPos[2] = endOnAxis.point[2];

      // Apply snap.
      if (state.snap.translate > 0) {
        const s = state.snap.translate;
        if (axis === 'x') newPos[0] = Math.round(newPos[0] / s) * s;
        else if (axis === 'y') newPos[1] = Math.round(newPos[1] / s) * s;
        else newPos[2] = Math.round(newPos[2] / s) * s;
      }

      entity.transform.position = newPos;
      state.pendingRebuild.add(entity.id);
    } else {
      // Mouse released — commit the transform command.
      if (gizmo.dragStartTransform && gizmo.dragEntityId) {
        runCommand(state, new TransformEntityCommand(
          gizmo.dragEntityId,
          gizmo.dragStartTransform,
          entity.transform,
        ));
      }
      gizmo.dragging = false;
      gizmo.dragAxis = null;
      gizmo.dragStartTransform = null;
      gizmo.dragEntityId = null;
    }
  }
}

// Draw the gizmo as immediate-mode 3D overlays. Call between beginMode3D / endMode3D.
import { drawCube, drawRay } from 'bloom';

export function drawMoveGizmo(gizmo: MoveGizmoState): void {
  if (!gizmo.visible) return;

  const pos = gizmo.anchor;
  const len = GIZMO_LENGTH;

  // X axis — red.
  drawRay(
    { x: pos[0], y: pos[1], z: pos[2] },
    { x: len, y: 0, z: 0 },
    { r: 220, g: 60, b: 60, a: gizmo.dragAxis === 'x' ? 255 : 200 },
  );
  // Y axis — green.
  drawRay(
    { x: pos[0], y: pos[1], z: pos[2] },
    { x: 0, y: len, z: 0 },
    { r: 60, g: 200, b: 60, a: gizmo.dragAxis === 'y' ? 255 : 200 },
  );
  // Z axis — blue.
  drawRay(
    { x: pos[0], y: pos[1], z: pos[2] },
    { x: 0, y: 0, z: len },
    { r: 60, g: 100, b: 240, a: gizmo.dragAxis === 'z' ? 255 : 200 },
  );
}
