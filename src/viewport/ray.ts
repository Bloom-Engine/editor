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
// ⚠ SHAPE MATTERS HERE — Perry 0.5.1208 miscompile (found 2026-07-17).
//
// The previous body computed each unprojected coordinate as one large
// expression of indexed matrix reads (`m[0]*ndcX + m[4]*ndcY + …`, 16 reads,
// twice, via an inlined helper). Perry emitted an element load with the BASE
// REGISTER DROPPED — `vmovq 0x8, %xmm6`, a read from absolute address 8 —
// and the editor died with 0xc0000005 on the first placement click or gizmo
// grab. The fault was LAYOUT-SENSITIVE: adding console.error lines made it
// vanish, which is why it dodged every earlier build (and why the smoke
// tests, which never click, never saw it). Repro binary + dump + pdb:
// main-repro.exe / crash_main_10580_6a59eadc.dmp.
//
// The dodge, same family as shooter perry-quirks #8 (clamp) and the Map-field
// AV: hoist every element into a named scalar FIRST, then do only scalar
// arithmetic — the exact idiom mat4Invert uses, which has always compiled
// correctly. Pinned by testMouseRay in the self-tests, which calls this
// function headless and would have crashed in the broken binary.
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

  // Hoist the inverse view-projection into scalars (see the header comment —
  // do NOT fold these back into the expressions below).
  const m0 = ivp[0], m1 = ivp[1], m2 = ivp[2], m3 = ivp[3];
  const m4 = ivp[4], m5 = ivp[5], m6 = ivp[6], m7 = ivp[7];
  const m8 = ivp[8], m9 = ivp[9], m10 = ivp[10], m11 = ivp[11];
  const m12 = ivp[12], m13 = ivp[13], m14 = ivp[14], m15 = ivp[15];

  // NDC coords: -1..1 range, Y flipped.
  const ndcX = ((mouseX - viewportLeft) / viewportW) * 2 - 1;
  const ndcY = 1 - ((mouseY - viewportTop) / viewportH) * 2;

  // Unproject the near-plane point (ndcZ = -1)...
  const nwInv = 1 / (m3 * ndcX + m7 * ndcY - m11 + m15);
  const nx = (m0 * ndcX + m4 * ndcY - m8 + m12) * nwInv;
  const ny = (m1 * ndcX + m5 * ndcY - m9 + m13) * nwInv;
  const nz = (m2 * ndcX + m6 * ndcY - m10 + m14) * nwInv;

  // ...and the far-plane point (ndcZ = +1).
  const fwInv = 1 / (m3 * ndcX + m7 * ndcY + m11 + m15);
  const fx = (m0 * ndcX + m4 * ndcY + m8 + m12) * fwInv;
  const fy = (m1 * ndcX + m5 * ndcY + m9 + m13) * fwInv;
  const fz = (m2 * ndcX + m6 * ndcY + m10 + m14) * fwInv;

  // Direction = far - near, normalized.
  let dx = fx - nx;
  let dy = fy - ny;
  let dz = fz - nz;
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

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
