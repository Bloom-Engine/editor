// Splat-layer commands: add a layer, remove a layer, and paint a stroke.
//
// A paint stroke snapshots EVERY layer's weights, not just the active one.
// Painting grass onto a cell necessarily takes weight away from the dirt that
// was there — a splat is a partition of unity, so one brush dab writes to all
// of them. Undoing a stroke that only restored the layer you were holding would
// leave the others carrying the erosion, and the terrain would drift a little
// further from correct with every Ctrl+Z.

import { TerrainLayer, createTerrainLayer } from 'bloom/world';
import { EditorState, Command } from '../editor-state';

/// Copy the weights of every layer. Used for both halves of a stroke.
export function snapshotWeights(layers: TerrainLayer[]): number[][] {
  const out = new Array<number[]>(layers.length);
  for (let i = 0; i < layers.length; i++) out[i] = layers[i].weights.slice();
  return out;
}

/// Rebuild `t.layers` with `add` appended, or with index `drop` removed.
///
/// Explicit construction rather than `.push()` / `.splice()`: `t.layers` came
/// out of `JSON.parse`, and a JSON-parsed array grown with `.push()` is the
/// exact shape Perry's array bridge gets wrong (`.length` reports the literal
/// init size — perry-quirks #2). The undo stack can afford `.push()` because it
/// never crosses the FFI; a layer list that gets serialized back to disk cannot.
function rebuildLayers(layers: TerrainLayer[], add: TerrainLayer | null, drop: number, at: number): TerrainLayer[] {
  const n = layers.length + (add !== null ? 1 : 0) - (drop >= 0 ? 1 : 0);
  const out = new Array<TerrainLayer>(n);
  let w = 0;
  for (let i = 0; i < layers.length; i++) {
    if (i === drop) continue;
    if (add !== null && w === at) { out[w] = add; w++; }
    out[w] = layers[i];
    w++;
  }
  if (add !== null && w === at) { out[w] = add; w++; }
  return out;
}

function restoreWeights(state: EditorState, snap: number[][]): void {
  const t = state.world.terrain;
  if (!t) return;
  // A stroke's snapshot is only valid against the layer set it was taken from.
  // If layers have since been added or removed the stroke is unreplayable, and
  // silently writing a stale snapshot over a different layer set would scramble
  // the paint. Undo/redo interleaved with add/remove is the case; refuse it.
  if (snap.length !== t.layers.length) return;
  for (let i = 0; i < snap.length; i++) t.layers[i].weights = snap[i].slice();
  state.pendingTerrainRebuild = true;
}

export class TerrainPaintCommand implements Command {
  readonly label: string;
  private before: number[][];
  private after: number[][];

  constructor(before: number[][], after: number[][]) {
    this.label = 'Paint terrain';
    this.before = before;
    this.after = after;
  }

  do(state: EditorState): void { restoreWeights(state, this.after); }
  undo(state: EditorState): void { restoreWeights(state, this.before); }
}

export class AddTerrainLayerCommand implements Command {
  readonly label: string;
  private id: string;
  private textureRef: string;
  private tileScale: number;

  constructor(id: string, textureRef: string, tileScale: number) {
    this.label = 'Add terrain layer';
    this.id = id;
    this.textureRef = textureRef;
    this.tileScale = tileScale;
  }

  do(state: EditorState): void {
    const t = state.world.terrain;
    if (!t) return;
    const layer = createTerrainLayer(t, this.id, this.textureRef, this.tileScale);
    t.layers = rebuildLayers(t.layers, layer, -1, t.layers.length);
    // Select what you just made — otherwise the first thing every user does
    // after adding a layer is paint with the previous one.
    state.brush.activeLayerIdx = t.layers.length - 1;
    state.pendingTerrainRebuild = true;
  }

  undo(state: EditorState): void {
    const t = state.world.terrain;
    if (!t || t.layers.length === 0) return;
    t.layers = rebuildLayers(t.layers, null, t.layers.length - 1, -1);
    if (state.brush.activeLayerIdx >= t.layers.length) {
      state.brush.activeLayerIdx = t.layers.length - 1;
    }
    state.pendingTerrainRebuild = true;
  }
}

export class RemoveTerrainLayerCommand implements Command {
  readonly label: string;
  private idx: number;
  private removed: TerrainLayer | null;

  constructor(idx: number) {
    this.label = 'Remove terrain layer';
    this.idx = idx;
    this.removed = null;
  }

  do(state: EditorState): void {
    const t = state.world.terrain;
    if (!t || this.idx < 0 || this.idx >= t.layers.length) return;
    // Hold the whole layer, weights included: removing a painted layer and
    // undoing must give the paint back, not an empty layer with the right name.
    this.removed = t.layers[this.idx];
    t.layers = rebuildLayers(t.layers, null, this.idx, -1);
    if (state.brush.activeLayerIdx >= t.layers.length) {
      state.brush.activeLayerIdx = t.layers.length - 1;
    }
    state.pendingTerrainRebuild = true;
  }

  undo(state: EditorState): void {
    const t = state.world.terrain;
    if (!t || !this.removed) return;
    t.layers = rebuildLayers(t.layers, this.removed, -1, this.idx);
    state.pendingTerrainRebuild = true;
  }
}
