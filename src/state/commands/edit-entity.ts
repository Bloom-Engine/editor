// Commands for entity properties other than transform: rename, tint, tags,
// and modelRef reassignment (PLAN §F2). All undoable.
//
// Tint, tags, and modelRef changes DESTROY and re-create the entity's scene
// node rather than just flagging a rebuild: syncRebuilds only updates
// transform + tint on an existing node, so a swapped model or a removed tint
// would otherwise leave the old mesh/color on screen. Destroys run before
// rebuilds within the same frame, so the swap is seamless.

import { Vec4Lit } from 'bloom/world';
import { EditorState, Command, EntityId, handleOfEntity } from '../editor-state';

function findEntity(state: EditorState, id: EntityId) {
  for (let i = 0; i < state.world.entities.length; i++) {
    if (state.world.entities[i].id === id) return state.world.entities[i];
  }
  return null;
}

// Tear down the scene node (if any) and queue a fresh build.
function rebuildNode(state: EditorState, id: EntityId): void {
  const handle = handleOfEntity(state.handles, id);
  if (handle !== 0) state.pendingDestroy.add(handle);
  state.pendingRebuild.add(id);
}

function cloneTint(t: Vec4Lit | null): Vec4Lit | null {
  if (t === null) return null;
  return [t[0], t[1], t[2], t[3]];
}

// ---- rename ------------------------------------------------------------------

export class RenameEntityCommand implements Command {
  readonly label: string;
  readonly entityId: EntityId;
  private before: string;
  private after: string;

  constructor(entityId: EntityId, before: string, after: string) {
    this.entityId = entityId;
    this.before = before;
    this.after = after;
    this.label = 'Rename ' + entityId;
  }

  do(state: EditorState): void {
    const e = findEntity(state, this.entityId);
    if (e) e.name = this.after;
  }

  undo(state: EditorState): void {
    const e = findEntity(state, this.entityId);
    if (e) e.name = this.before;
  }

  // Keystrokes coalesce: one undo entry per rename, not per character.
  mergeWith(next: Command): boolean {
    if (!(next instanceof RenameEntityCommand)) return false;
    if ((next as RenameEntityCommand).entityId !== this.entityId) return false;
    this.after = (next as RenameEntityCommand).after;
    return true;
  }
}

// ---- tint ----------------------------------------------------------------------

export class SetTintCommand implements Command {
  readonly label: string;
  readonly entityId: EntityId;
  private before: Vec4Lit | null;
  private after: Vec4Lit | null;

  constructor(entityId: EntityId, before: Vec4Lit | null, after: Vec4Lit | null) {
    this.entityId = entityId;
    this.before = cloneTint(before);
    this.after = cloneTint(after);
    this.label = 'Tint ' + entityId;
  }

  do(state: EditorState): void {
    const e = findEntity(state, this.entityId);
    if (e) {
      e.tint = cloneTint(this.after);
      rebuildNode(state, this.entityId);
    }
  }

  undo(state: EditorState): void {
    const e = findEntity(state, this.entityId);
    if (e) {
      e.tint = cloneTint(this.before);
      rebuildNode(state, this.entityId);
    }
  }

  // Color-field drags coalesce like transform drags — but only value->value
  // edits. Add (null->v) and remove (v->null) are discrete operations: if the
  // add merged with the drag that follows it, Ctrl+Z after "add tint, tweak
  // it" would remove the tint entirely instead of undoing the tweak.
  mergeWith(next: Command): boolean {
    if (!(next instanceof SetTintCommand)) return false;
    const n = next as SetTintCommand;
    if (n.entityId !== this.entityId) return false;
    if (this.before === null || this.after === null) return false;
    if (n.before === null || n.after === null) return false;
    this.after = cloneTint(n.after);
    return true;
  }
}

// ---- tags ----------------------------------------------------------------------

export class SetTagsCommand implements Command {
  readonly label: string;
  readonly entityId: EntityId;
  private before: string[];
  private after: string[];

  constructor(entityId: EntityId, before: string[], after: string[]) {
    this.entityId = entityId;
    this.before = before.slice();
    this.after = after.slice();
    this.label = 'Tags ' + entityId;
  }

  do(state: EditorState): void {
    const e = findEntity(state, this.entityId);
    if (e) {
      e.tags = this.after.slice();
      // Placeholder colors key off tags (static_mesh convention), so the
      // node must rebuild for the change to show.
      rebuildNode(state, this.entityId);
    }
  }

  undo(state: EditorState): void {
    const e = findEntity(state, this.entityId);
    if (e) {
      e.tags = this.before.slice();
      rebuildNode(state, this.entityId);
    }
  }
}

// ---- modelRef -------------------------------------------------------------------

export class SetModelRefCommand implements Command {
  readonly label: string;
  readonly entityId: EntityId;
  private before: string | null;
  private after: string | null;

  constructor(entityId: EntityId, before: string | null, after: string | null) {
    this.entityId = entityId;
    this.before = before;
    this.after = after;
    this.label = 'Model ' + entityId;
  }

  do(state: EditorState): void {
    const e = findEntity(state, this.entityId);
    if (e) {
      e.modelRef = this.after;
      rebuildNode(state, this.entityId);
    }
  }

  undo(state: EditorState): void {
    const e = findEntity(state, this.entityId);
    if (e) {
      e.modelRef = this.before;
      rebuildNode(state, this.entityId);
    }
  }
}
