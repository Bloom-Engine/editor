// Command: destroy an entity from the world.
// Undoing re-adds it and marks its scene node for rebuild.

import { EntityData } from 'bloom/world';
import { EditorState, Command } from '../editor-state';

export class DestroyEntityCommand implements Command {
  readonly label: string;
  private entity: EntityData;
  private index: number;  // Original index in the entities array for undo.

  constructor(entity: EntityData, index: number) {
    this.entity = entity;
    this.index = index;
    this.label = 'Delete ' + entity.name;
  }

  do(state: EditorState): void {
    const idx = state.world.entities.findIndex(
      (e: EntityData) => e.id === this.entity.id,
    );
    if (idx >= 0) {
      state.world.entities.splice(idx, 1);
    }
    const handle = state.handles.byEntity.get(this.entity.id);
    if (handle !== undefined) {
      state.pendingDestroy.add(handle);
    }
    state.selection.ids.delete(this.entity.id);
    if (state.selection.primary === this.entity.id) {
      state.selection.primary = null;
    }
  }

  undo(state: EditorState): void {
    // Re-insert at original index (clamped to bounds).
    const insertAt = this.index <= state.world.entities.length ? this.index : state.world.entities.length;
    state.world.entities.splice(insertAt, 0, this.entity);
    state.pendingRebuild.add(this.entity.id);
  }
}
