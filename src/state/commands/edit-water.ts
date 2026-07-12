// Commands for water volumes and rivers: edit a property, or remove one.
//
// Water/river edits are drag-driven (the same dragFloat widgets as the entity
// inspector), so the edit commands coalesce like TransformEntityCommand — one
// undo entry per drag, not one per frame.

import { WaterVolume, RiverSpline } from 'bloom/world';
import { EditorState, Command } from '../editor-state';

// Snapshot/restore the whole record. Water and river records are small (a
// handful of scalars plus a colour), so storing before/after copies is simpler
// and safer than a per-field command, and it merges trivially.
function cloneWater(w: WaterVolume): WaterVolume {
  return {
    id: w.id,
    kind: w.kind,
    center: [w.center[0], w.center[1], w.center[2]],
    size: [w.size[0], w.size[1], w.size[2]],
    surfaceHeight: w.surfaceHeight,
    color: [w.color[0], w.color[1], w.color[2], w.color[3]],
    waveAmplitude: w.waveAmplitude,
    waveSpeed: w.waveSpeed,
  };
}

function cloneRiver(r: RiverSpline): RiverSpline {
  const points: [number, number, number][] = [];
  for (let i = 0; i < r.controlPoints.length; i++) {
    const p = r.controlPoints[i];
    points.push([p[0], p[1], p[2]]);
  }
  return {
    id: r.id,
    controlPoints: points,
    widths: r.widths.slice(),
    depth: r.depth,
    flowSpeed: r.flowSpeed,
    color: [r.color[0], r.color[1], r.color[2], r.color[3]],
  };
}

export class EditWaterCommand implements Command {
  readonly label: string;
  readonly waterId: string;
  private before: WaterVolume;
  private after: WaterVolume;

  constructor(waterId: string, before: WaterVolume, after: WaterVolume) {
    this.waterId = waterId;
    this.before = cloneWater(before);
    this.after = cloneWater(after);
    this.label = 'Edit water ' + waterId;
  }

  do(state: EditorState): void { this.apply(state, this.after); }
  undo(state: EditorState): void { this.apply(state, this.before); }

  private apply(state: EditorState, value: WaterVolume): void {
    for (let i = 0; i < state.world.water.length; i++) {
      if (state.world.water[i].id !== this.waterId) continue;
      state.world.water[i] = cloneWater(value);
      state.pendingWaterRebuild = true;
      return;
    }
  }

  mergeWith(next: Command): boolean {
    if (!(next instanceof EditWaterCommand)) return false;
    const n = next as EditWaterCommand;
    if (n.waterId !== this.waterId) return false;
    this.after = cloneWater(n.after);
    return true;
  }
}

export class EditRiverCommand implements Command {
  readonly label: string;
  readonly riverId: string;
  private before: RiverSpline;
  private after: RiverSpline;

  constructor(riverId: string, before: RiverSpline, after: RiverSpline) {
    this.riverId = riverId;
    this.before = cloneRiver(before);
    this.after = cloneRiver(after);
    this.label = 'Edit river ' + riverId;
  }

  do(state: EditorState): void { this.apply(state, this.after); }
  undo(state: EditorState): void { this.apply(state, this.before); }

  private apply(state: EditorState, value: RiverSpline): void {
    for (let i = 0; i < state.world.rivers.length; i++) {
      if (state.world.rivers[i].id !== this.riverId) continue;
      state.world.rivers[i] = cloneRiver(value);
      state.pendingWaterRebuild = true;
      return;
    }
  }

  mergeWith(next: Command): boolean {
    if (!(next instanceof EditRiverCommand)) return false;
    const n = next as EditRiverCommand;
    if (n.riverId !== this.riverId) return false;
    this.after = cloneRiver(n.after);
    return true;
  }
}

export class RemoveWaterCommand implements Command {
  readonly label: string;
  private volume: WaterVolume;
  private index: number;

  constructor(volume: WaterVolume, index: number) {
    this.volume = cloneWater(volume);
    this.index = index;
    this.label = 'Remove water ' + volume.id;
  }

  do(state: EditorState): void {
    const idx = state.world.water.findIndex(w => w.id === this.volume.id);
    if (idx >= 0) state.world.water.splice(idx, 1);
    if (state.selection.kind === 'water' && state.selection.primary === this.volume.id) {
      state.selection.primary = null;
      state.selection.kind = 'entity';
    }
    state.pendingWaterRebuild = true;
  }

  undo(state: EditorState): void {
    // Restore at the original index so ids and ordering round-trip unchanged.
    state.world.water.splice(this.index, 0, cloneWater(this.volume));
    state.pendingWaterRebuild = true;
  }
}

export class RemoveRiverCommand implements Command {
  readonly label: string;
  private river: RiverSpline;
  private index: number;

  constructor(river: RiverSpline, index: number) {
    this.river = cloneRiver(river);
    this.index = index;
    this.label = 'Remove river ' + river.id;
  }

  do(state: EditorState): void {
    const idx = state.world.rivers.findIndex(r => r.id === this.river.id);
    if (idx >= 0) state.world.rivers.splice(idx, 1);
    if (state.selection.kind === 'river' && state.selection.primary === this.river.id) {
      state.selection.primary = null;
      state.selection.kind = 'entity';
    }
    state.pendingWaterRebuild = true;
  }

  undo(state: EditorState): void {
    state.world.rivers.splice(this.index, 0, cloneRiver(this.river));
    state.pendingWaterRebuild = true;
  }
}
