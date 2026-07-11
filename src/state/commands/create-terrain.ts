// Explicit terrain creation. A world without terrain stays without terrain
// until the user asks for one — a stray brush stroke must never add a
// heightmap silently (both shooter arenas ship with terrain: null on purpose).
// Undo returns world.terrain to null; the sync layer then removes the node.

import { defaultTerrain } from 'bloom/world';
import { EditorState, Command } from '../editor-state';

export class CreateTerrainCommand implements Command {
  readonly label = 'Create terrain';

  do(state: EditorState): void {
    state.world.terrain = defaultTerrain();
    state.pendingTerrainRebuild = true;
  }

  undo(state: EditorState): void {
    state.world.terrain = null;
    state.pendingTerrainRebuild = true;
  }
}
