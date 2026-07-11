// Command: create a new entity in the world.
// Undoing removes the entity and its scene node.

import { EntityData } from 'bloom/world';
import { EditorState, Command } from '../editor-state';

export class CreateEntityCommand implements Command {
  readonly label: string;
  private entity: EntityData;

  constructor(entity: EntityData) {
    this.entity = entity;
    this.label = 'Place ' + entity.name;
  }

  do(state: EditorState): void {
    state.world.entities.push(this.entity);
    state.pendingRebuild.add(this.entity.id);
  }

  undo(state: EditorState): void {
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
    // If this entity was selected, deselect it.
    state.selection.ids.delete(this.entity.id);
    if (state.selection.primary === this.entity.id) {
      state.selection.primary = null;
    }
  }
}
