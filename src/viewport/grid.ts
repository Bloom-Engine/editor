// Ground grid + world axes rendered in the 3D viewport.
// Must be called between beginMode3D and endMode3D.

import { drawGrid, drawRay } from 'bloom';

export function drawGroundGrid(): void {
  drawGrid(20, 1.0);
}

export function drawWorldAxes(): void {
  const len = 100;
  // X axis — red
  drawRay({ x: 0, y: 0.01, z: 0 }, { x: len, y: 0, z: 0 }, { r: 220, g: 50, b: 50, a: 180 });
  // Z axis — blue
  drawRay({ x: 0, y: 0.01, z: 0 }, { x: 0, y: 0, z: len }, { r: 50, g: 50, b: 220, a: 180 });
}
