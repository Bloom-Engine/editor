// Command: change an entity's transform. Supports mergeWith so a continuous
// gizmo drag produces a single undo entry rather than one per mouse-move frame.

import { TransformData, Vec3Lit } from 'bloom/world';
import { EditorState, Command, EntityId } from '../editor-state';

export class TransformEntityCommand implements Command {
  readonly label: string;
  readonly entityId: EntityId;
  private before: TransformData;
  private after: TransformData;

  constructor(entityId: EntityId, before: TransformData, after: TransformData) {
    this.entityId = entityId;
    this.before = cloneTransform(before);
    this.after = cloneTransform(after);
    this.label = 'Transform ' + entityId;
  }

  do(state: EditorState): void {
    const entity = findEntity(state, this.entityId);
    if (entity) {
      entity.transform = cloneTransform(this.after);
      state.pendingRebuild.add(this.entityId);
    }
  }

  undo(state: EditorState): void {
    const entity = findEntity(state, this.entityId);
    if (entity) {
      entity.transform = cloneTransform(this.before);
      state.pendingRebuild.add(this.entityId);
    }
  }

  // Merge consecutive TransformEntityCommands on the same entity. The
  // merged command retains the original `before` and takes the new `after`.
  mergeWith(next: Command): boolean {
    if (!(next instanceof TransformEntityCommand)) return false;
    if ((next as TransformEntityCommand).entityId !== this.entityId) return false;
    this.after = cloneTransform((next as TransformEntityCommand).after);
    return true;
  }
}

function findEntity(state: EditorState, id: EntityId): { transform: TransformData } | null {
  for (let i = 0; i < state.world.entities.length; i++) {
    if (state.world.entities[i].id === id) return state.world.entities[i];
  }
  return null;
}

function cloneTransform(t: TransformData): TransformData {
  return {
    position: [t.position[0], t.position[1], t.position[2]],
    rotation: [t.rotation[0], t.rotation[1], t.rotation[2]],
    scale: [t.scale[0], t.scale[1], t.scale[2]],
  };
}
