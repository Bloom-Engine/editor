// Terrain brush tool — sculpt the heightmap with raise/lower/smooth/flatten.
//
// Active when state.activeTool === 'brush'. Uses raycastTerrain from
// bloom/world/terrain to find the hit cell, then applies the brush kernel
// to heights within the configured radius.
//
// Brush strokes are undoable: on stroke start, the full heights array is
// snapshotted. On stroke end, a TerrainStrokeCommand is emitted that holds
// both the before and after snapshots. Undo restores the before snapshot.

import { isMouseButtonDown, isMouseButtonPressed, isMouseButtonReleased, MouseButton, getMouseX, getMouseY, getScreenWidth, getScreenHeight, getDeltaTime } from 'bloom';
import { raycastTerrain, TerrainData } from 'bloom/world';
import { EditorState } from '../state/editor-state';
import { runCommand } from '../state/commands';
import { mouseToWorldRay } from '../viewport/ray';
import { Command } from '../state/editor-state';

// ---- Terrain stroke command ------------------------------------------------

class TerrainStrokeCommand implements Command {
  readonly label: string;
  private before: number[];
  private after: number[];

  constructor(before: number[], after: number[]) {
    this.label = 'Terrain stroke';
    this.before = before;
    this.after = after;
  }

  do(state: EditorState): void {
    if (state.world.terrain) {
      state.world.terrain.heights = this.after.slice();
      state.pendingTerrainRebuild = true;
    }
  }

  undo(state: EditorState): void {
    if (state.world.terrain) {
      state.world.terrain.heights = this.before.slice();
      state.pendingTerrainRebuild = true;
    }
  }
}

// ---- Brush state -----------------------------------------------------------

interface BrushToolState {
  stroking: boolean;
  heightsSnapshot: number[] | null;
}

const brushState: BrushToolState = {
  stroking: false,
  heightsSnapshot: null,
};

// ---- Update ----------------------------------------------------------------

export function updateBrushTool(state: EditorState): void {
  if (state.activeTool !== 'brush') {
    if (brushState.stroking) endStroke(state);
    return;
  }

  // No terrain — sculpting requires explicit creation first (the brush
  // panel's "Create terrain" button, an undoable command). Silently creating
  // one here would corrupt terrain-less worlds on a stray click.
  if (!state.world.terrain) return;

  const terrain = state.world.terrain as TerrainData;
  const mx = getMouseX();
  const my = getMouseY();
  const inViewport = mx > state.viewportLeft && mx < state.viewportRight &&
                     my > state.viewportTop && my < state.viewportBottom;
  if (!inViewport) return;

  const vw = state.viewportRight - state.viewportLeft;
  const vh = state.viewportBottom - state.viewportTop;
  const ray = mouseToWorldRay(
    state.camera, mx, my,
    getScreenWidth(), getScreenHeight(),
    state.viewportLeft, state.viewportTop, vw, vh,
  );

  const hit = raycastTerrain(terrain, ray.origin, ray.direction, 200, 0.5);
  if (!hit.hit) return;

  // Start stroke.
  if (isMouseButtonPressed(MouseButton.LEFT)) {
    brushState.stroking = true;
    brushState.heightsSnapshot = terrain.heights.slice();
  }

  // Apply brush while mouse is held.
  if (brushState.stroking && isMouseButtonDown(MouseButton.LEFT)) {
    applyBrush(state, terrain, hit.cellX, hit.cellZ);
    state.pendingTerrainRebuild = true;
  }

  // End stroke.
  if (brushState.stroking && isMouseButtonReleased(MouseButton.LEFT)) {
    endStroke(state);
  }
}

function endStroke(state: EditorState): void {
  if (brushState.heightsSnapshot && state.world.terrain) {
    runCommand(state, new TerrainStrokeCommand(
      brushState.heightsSnapshot,
      state.world.terrain.heights.slice(),
    ));
  }
  brushState.stroking = false;
  brushState.heightsSnapshot = null;
}

// ---- Brush kernels ---------------------------------------------------------

function applyBrush(state: EditorState, t: TerrainData, cx: number, cz: number): void {
  const brush = state.brush;
  const r = Math.ceil(brush.radius);
  const dt = getDeltaTime();

  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx;
      const z = cz + dz;
      if (x < 0 || x >= t.width || z < 0 || z >= t.depth) continue;

      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > brush.radius) continue;

      const falloff = 1.0 - dist / brush.radius;
      const idx = z * t.width + x;

      if (brush.kind === 'raise') {
        t.heights[idx] += brush.strength * falloff * dt * 10;
      } else if (brush.kind === 'lower') {
        t.heights[idx] -= brush.strength * falloff * dt * 10;
      } else if (brush.kind === 'smooth') {
        const avg = avgNeighbors(t, x, z);
        t.heights[idx] += (avg - t.heights[idx]) * brush.strength * falloff * dt * 5;
      } else if (brush.kind === 'flatten') {
        t.heights[idx] += (brush.targetHeight - t.heights[idx]) * brush.strength * falloff * dt * 5;
      }
    }
  }
}

function avgNeighbors(t: TerrainData, x: number, z: number): number {
  let sum = 0;
  let count = 0;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dz === 0) continue;
      const nx = x + dx;
      const nz = z + dz;
      if (nx >= 0 && nx < t.width && nz >= 0 && nz < t.depth) {
        sum += t.heights[nz * t.width + nx];
        count++;
      }
    }
  }
  return count > 0 ? sum / count : t.heights[z * t.width + x];
}
