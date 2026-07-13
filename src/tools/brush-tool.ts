// Terrain brush tool — sculpt the heightmap with raise/lower/smooth/flatten.
//
// Active when state.activeTool === 'brush'. Uses raycastTerrain from
// bloom/world/terrain to find the hit cell, then applies the brush kernel
// to heights within the configured radius.
//
// Brush strokes are undoable: on stroke start, the full heights array is
// snapshotted. On stroke end, a TerrainStrokeCommand is emitted that holds
// both the before and after snapshots. Undo restores the before snapshot.

import { isMouseButtonDown, isMouseButtonPressed, isMouseButtonReleased, MouseButton, getMouseX, getMouseY, getScreenWidth, getScreenHeight, getDeltaTime, isKeyDown, Key } from 'bloom';
import { raycastTerrain, TerrainData, TerrainLayer, quantizeWeight } from 'bloom/world';
import { EditorState } from '../state/editor-state';
import { runCommand } from '../state/commands';
import { TerrainPaintCommand, snapshotWeights } from '../state/commands/terrain-paint';
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
  weightsSnapshot: number[][] | null;   // Paint strokes: every layer, see terrain-paint.ts.
}

const brushState: BrushToolState = {
  stroking: false,
  heightsSnapshot: null,
  weightsSnapshot: null,
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

  const painting = state.brush.kind === 'paint';

  // Painting with no layer to paint into is a no-op, not a crash. The panel
  // says so; do not let a click through to an out-of-range index.
  if (painting && (terrain.layers.length === 0 ||
      state.brush.activeLayerIdx < 0 ||
      state.brush.activeLayerIdx >= terrain.layers.length)) {
    return;
  }

  // Start stroke.
  if (isMouseButtonPressed(MouseButton.LEFT)) {
    brushState.stroking = true;
    if (painting) {
      brushState.weightsSnapshot = snapshotWeights(terrain.layers);
    } else {
      brushState.heightsSnapshot = terrain.heights.slice();
    }
  }

  // Apply brush while mouse is held.
  if (brushState.stroking && isMouseButtonDown(MouseButton.LEFT)) {
    if (painting) {
      applyPaint(state, terrain, hit.cellX, hit.cellZ);
    } else {
      applyBrush(state, terrain, hit.cellX, hit.cellZ);
    }
    state.pendingTerrainRebuild = true;
  }

  // End stroke.
  if (brushState.stroking && isMouseButtonReleased(MouseButton.LEFT)) {
    endStroke(state);
  }
}

function endStroke(state: EditorState): void {
  const t = state.world.terrain;
  if (t) {
    if (brushState.weightsSnapshot) {
      runCommand(state, new TerrainPaintCommand(
        brushState.weightsSnapshot,
        snapshotWeights(t.layers),
      ));
    } else if (brushState.heightsSnapshot) {
      runCommand(state, new TerrainStrokeCommand(
        brushState.heightsSnapshot,
        t.heights.slice(),
      ));
    }
  }
  brushState.stroking = false;
  brushState.heightsSnapshot = null;
  brushState.weightsSnapshot = null;
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

// ---- Paint -----------------------------------------------------------------

/// Paint the active splat layer under the brush. Hold Shift to erase.
///
/// A splat is a partition: the four (or eight) weights at a cell say what
/// fraction of the ground is grass, dirt, rock. So painting grass IN must push
/// everything else OUT, or the weights sum past 1 and the shader renders a cell
/// that is 90% grass AND 90% rock — which reads as a washed-out average of every
/// texture at once, the classic "my terrain went grey" bug.
///
/// Erasing does NOT push the others back up. It drives the active layer toward
/// zero and leaves the rest where they are, so the cell's total coverage falls —
/// and coverage is exactly what the shooter's shader uses to blend back to its
/// procedural slope/moisture blend. Erase everything and you get the untouched
/// terrain, not a bald patch.
function applyPaint(state: EditorState, t: TerrainData, cx: number, cz: number): void {
  const brush = state.brush;
  const active = brush.activeLayerIdx;
  const layers = t.layers;
  const n = layers.length;
  const r = Math.ceil(brush.radius);
  const dt = getDeltaTime();
  const erase = isKeyDown(Key.LeftShift) || isKeyDown(Key.RightShift);
  const target = erase ? 0.0 : 1.0;

  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx;
      const z = cz + dz;
      if (x < 0 || x >= t.width || z < 0 || z >= t.depth) continue;

      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > brush.radius) continue;

      const falloff = 1.0 - dist / brush.radius;
      const idx = z * t.width + x;

      // Rate is deliberately brisk (×4): a splat weight only has to travel 0..1,
      // where a sculpt brush moves metres, so the same strength value would feel
      // dead here.
      const amount = Math.min(brush.strength * falloff * dt * 4.0, 1.0);
      paintCell(layers, active, idx, target, amount);
    }
  }
}

/// Move one cell's splat weights toward `target` for layer `active`, then keep
/// the cell a valid partition. Pure, and exported so the self-tests can exercise
/// the part that is actually easy to get wrong without a mouse and a frame clock.
export function paintCell(
  layers: TerrainLayer[], active: number, idx: number,
  target: number, amount: number,
): void {
  const n = layers.length;
  const prev = layers[active].weights[idx];
  const next = quantizeWeight(prev + (target - prev) * amount);
  layers[active].weights[idx] = next;

  // Re-normalize the others so the cell's total never exceeds 1. Scaling them
  // proportionally (rather than subtracting equally) is what keeps a 70/30
  // dirt/rock mix reading as 70/30 after grass is painted over the top of it.
  let others = 0;
  for (let l = 0; l < n; l++) {
    if (l !== active) others = others + layers[l].weights[idx];
  }
  const room = 1.0 - next;
  if (others > room && others > 0.0) {
    const k = room / others;
    for (let l = 0; l < n; l++) {
      if (l === active) continue;
      layers[l].weights[idx] = quantizeWeight(layers[l].weights[idx] * k);
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
