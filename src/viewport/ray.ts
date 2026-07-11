// Ray math for the viewport: mouse → world ray unprojection, and
// ray-vs-line-segment closest approach (for gizmo hit-testing).

import {
  mat4Multiply, mat4Invert, mat4Perspective, mat4LookAt,
} from 'bloom';
import { OrbitCamera } from '../state/editor-state';
import { cameraEyePosition } from './orbit-camera';

export interface Ray3 {
  origin: [number, number, number];
  direction: [number, number, number]; // Normalized.
}

// Unproject a screen-space pixel (x, y) into a world-space ray originating
// from the camera eye and passing through the pixel on the near plane.
// `screenW` and `screenH` are the viewport pixel dimensions.
export function mouseToWorldRay(
  cam: OrbitCamera,
  mouseX: number, mouseY: number,
  screenW: number, screenH: number,
  viewportLeft: number, viewportTop: number,
  viewportW: number, viewportH: number,
): Ray3 {
  const eye = cameraEyePosition(cam);
  const target = cam.target;
  const aspect = viewportW / viewportH;

  // Build view + projection matrices, then invert their product.
  const view = mat4LookAt(
    { x: eye[0], y: eye[1], z: eye[2] },
    { x: target[0], y: target[1], z: target[2] },
    { x: 0, y: 1, z: 0 },
  );
  const proj = mat4Perspective(cam.fovy * Math.PI / 180, aspect, 0.1, 1000);
  const vp = mat4Multiply(proj, view);
  const ivp = mat4Invert(vp);

  // NDC coords: -1..1 range, Y flipped.
  const ndcX = ((mouseX - viewportLeft) / viewportW) * 2 - 1;
  const ndcY = 1 - ((mouseY - viewportTop) / viewportH) * 2;

  // Unproject near point and far point.
  const near = unprojectPoint(ivp, ndcX, ndcY, -1);
  const far = unprojectPoint(ivp, ndcX, ndcY, 1);

  // Direction = far - near, normalized.
  let dx = far[0] - near[0];
  let dy = far[1] - near[1];
  let dz = far[2] - near[2];
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len > 0) { dx /= len; dy /= len; dz /= len; }

  return { origin: eye, direction: [dx, dy, dz] };
}

// Compute the closest approach between a ray and a finite line segment.
// Returns { t: parameter on ray, dist: distance, point: closest on segment }.
// Used by gizmo handle hit-testing (depth-independent).
export function raySegmentDistance(
  ray: Ray3,
  a: [number, number, number],
  b: [number, number, number],
): { t: number; dist: number; point: [number, number, number] } {
  // Ray: P = O + t * D
  // Segment: Q = A + s * (B - A), s ∈ [0, 1]
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const ox = ray.origin[0] - a[0], oy = ray.origin[1] - a[1], oz = ray.origin[2] - a[2];
  const rd = ray.direction;

  const dDotD = dx * dx + dy * dy + dz * dz;
  const dDotR = dx * rd[0] + dy * rd[1] + dz * rd[2];
  const rDotR = rd[0] * rd[0] + rd[1] * rd[1] + rd[2] * rd[2];
  const dDotO = dx * ox + dy * oy + dz * oz;
  const rDotO = rd[0] * ox + rd[1] * oy + rd[2] * oz;

  const denom = dDotD * rDotR - dDotR * dDotR;
  let s: number;
  let t: number;

  if (Math.abs(denom) < 1e-10) {
    // Parallel lines — project origin onto segment.
    s = clamp01(dDotO / (dDotD || 1));
    t = (s * dDotR - rDotO) / (rDotR || 1);
  } else {
    s = clamp01((dDotO * rDotR - rDotO * dDotR) / denom);
    t = (s * dDotR - rDotO) / (rDotR || 1);
  }

  if (t < 0) t = 0;

  // Closest point on segment.
  const px = a[0] + s * dx;
  const py = a[1] + s * dy;
  const pz = a[2] + s * dz;
  // Point on ray at t.
  const qx = ray.origin[0] + t * rd[0];
  const qy = ray.origin[1] + t * rd[1];
  const qz = ray.origin[2] + t * rd[2];

  const ex = px - qx, ey = py - qy, ez = pz - qz;
  const dist = Math.sqrt(ex * ex + ey * ey + ez * ez);

  return { t, dist, point: [px, py, pz] };
}

// Ray-vs-plane intersection. Plane defined by a point and a normal.
// Returns the world-space hit point, or null if the ray is parallel.
export function rayPlaneIntersect(
  ray: Ray3,
  planePoint: [number, number, number],
  planeNormal: [number, number, number],
): [number, number, number] | null {
  const denom = planeNormal[0] * ray.direction[0] +
                planeNormal[1] * ray.direction[1] +
                planeNormal[2] * ray.direction[2];
  if (Math.abs(denom) < 1e-8) return null;

  const t = ((planePoint[0] - ray.origin[0]) * planeNormal[0] +
             (planePoint[1] - ray.origin[1]) * planeNormal[1] +
             (planePoint[2] - ray.origin[2]) * planeNormal[2]) / denom;
  if (t < 0) return null;

  return [
    ray.origin[0] + ray.direction[0] * t,
    ray.origin[1] + ray.direction[1] * t,
    ray.origin[2] + ray.direction[2] * t,
  ];
}

// ---- internals -------------------------------------------------------------

function unprojectPoint(
  invViewProj: number[], ndcX: number, ndcY: number, ndcZ: number,
): [number, number, number] {
  const m = invViewProj;
  const x = m[0] * ndcX + m[4] * ndcY + m[8] * ndcZ + m[12];
  const y = m[1] * ndcX + m[5] * ndcY + m[9] * ndcZ + m[13];
  const z = m[2] * ndcX + m[6] * ndcY + m[10] * ndcZ + m[14];
  const w = m[3] * ndcX + m[7] * ndcY + m[11] * ndcZ + m[15];
  const iw = 1 / w;
  return [x * iw, y * iw, z * iw];
}

function clamp01(v: number): number {
  return v < 0 ? 0 : (v > 1 ? 1 : v);
}
