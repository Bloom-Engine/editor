// Command: set, add, or remove a single userData key on an entity. userData is
// the game-defined side channel (spawner params, wave plans, collider extents),
// so the editor treats keys and values as opaque strings. Supports mergeWith so
// per-keystroke edits of the same key coalesce into one undo entry.

import { EditorState, Command, EntityId } from '../editor-state';

export class SetUserDataCommand implements Command {
  readonly label: string;
  readonly entityId: EntityId;
  readonly key: string;
  private before: string | null;   // null = key absent before.
  private after: string | null;    // null = key removed.

  constructor(entityId: EntityId, key: string, before: string | null, after: string | null) {
    this.entityId = entityId;
    this.key = key;
    this.before = before;
    this.after = after;
    this.label = 'Edit userData ' + key;
  }

  do(state: EditorState): void {
    this.apply(state, this.after);
  }

  undo(state: EditorState): void {
    this.apply(state, this.before);
  }

  private apply(state: EditorState, value: string | null): void {
    for (let i = 0; i < state.world.entities.length; i++) {
      const entity = state.world.entities[i];
      if (entity.id !== this.entityId) continue;
      if (value === null) {
        delete entity.userData[this.key];
      } else {
        entity.userData[this.key] = value;
      }
      // Placeholder color/size can depend on userData (kind, halfExtents).
      state.pendingRebuild.add(this.entityId);
      return;
    }
  }

  // Coalesce consecutive keystroke edits of the same key on the same entity.
  // Removals and additions never merge — they should stay separate undo steps.
  mergeWith(next: Command): boolean {
    if (!(next instanceof SetUserDataCommand)) return false;
    const n = next as SetUserDataCommand;
    if (n.entityId !== this.entityId || n.key !== this.key) return false;
    if (this.after === null || n.after === null || this.before === null) return false;
    this.after = n.after;
    return true;
  }
}
