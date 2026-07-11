// Command: duplicate the selected entity with a position offset.

import { EntityData, Vec3Lit } from 'bloom/world';
import { EditorState, Command, nextEntityId } from '../editor-state';

export class DuplicateEntityCommand implements Command {
  readonly label: string;
  private original: EntityData;
  private clone: EntityData | null;

  constructor(original: EntityData) {
    this.original = original;
    this.clone = null;
    this.label = 'Duplicate ' + original.name;
  }

  do(state: EditorState): void {
    if (!this.clone) {
      const id = nextEntityId(state);
      this.clone = {
        id: id,
        name: this.original.name + '_copy',
        modelRef: this.original.modelRef,
        prefabRef: this.original.prefabRef,
        transform: {
          position: [
            this.original.transform.position[0] + 2,
            this.original.transform.position[1],
            this.original.transform.position[2] + 2,
          ],
          rotation: [this.original.transform.rotation[0], this.original.transform.rotation[1], this.original.transform.rotation[2]],
          scale: [this.original.transform.scale[0], this.original.transform.scale[1], this.original.transform.scale[2]],
        },
        tint: this.original.tint ? [this.original.tint[0], this.original.tint[1], this.original.tint[2], this.original.tint[3]] : null,
        tags: this.original.tags.slice(),
        userData: {},
      };
    }
    state.world.entities.push(this.clone);
    state.pendingRebuild.add(this.clone.id);
    // Select the duplicate.
    state.selection.ids.clear();
    state.selection.ids.add(this.clone.id);
    state.selection.primary = this.clone.id;
  }

  undo(state: EditorState): void {
    if (!this.clone) return;
    const idx = state.world.entities.findIndex(e => e.id === (this.clone as EntityData).id);
    if (idx >= 0) state.world.entities.splice(idx, 1);
    const handle = state.handles.byEntity.get((this.clone as EntityData).id);
    if (handle !== undefined) state.pendingDestroy.add(handle);
    state.selection.ids.delete((this.clone as EntityData).id);
    if (state.selection.primary === (this.clone as EntityData).id) state.selection.primary = null;
  }
}
