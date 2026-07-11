// Shared gizmo math and types. Used by move, rotate, and scale gizmos.

import { Vec3Lit } from 'bloom/world';

export type GizmoAxis = 'x' | 'y' | 'z' | null;

export const GIZMO_LENGTH = 2.5;
export const HIT_THRESHOLD = 0.15;

export const AXIS_VECTORS: { x: Vec3Lit; y: Vec3Lit; z: Vec3Lit } = {
  x: [1, 0, 0],
  y: [0, 1, 0],
  z: [0, 0, 1],
};

export function axisColor(axis: GizmoAxis, active: boolean): { r: number; g: number; b: number; a: number } {
  const a = active ? 255 : 200;
  if (axis === 'x') return { r: 220, g: 60, b: 60, a };
  if (axis === 'y') return { r: 60, g: 200, b: 60, a };
  if (axis === 'z') return { r: 60, g: 100, b: 240, a };
  return { r: 180, g: 180, b: 180, a };
}
