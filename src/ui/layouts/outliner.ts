// Left-side outliner: everything in the world, in three sections — entities,
// water volumes, rivers. Clicking selects; the selection carries which section
// it came from, because ids are only unique within their own array.

import { getScreenHeight } from 'bloom';
import { UiContext } from '../ui-context';
import { beginPanel, endPanel, labelSmall, listRow } from '../widgets';
import { Theme } from '../theme';
import {
  EditorState, selectEntity, selectWater, selectRiver,
} from '../../state/editor-state';
import { syncSelectionOutline } from '../../viewport/picking';

export function drawOutliner(ui: UiContext, state: EditorState): void {
  const screenH = getScreenHeight();
  const pw = Theme.outlinerWidth;
  const py = Theme.toolbarHeight;
  const ph = screenH - Theme.toolbarHeight - Theme.statusBarHeight;

  beginPanel(ui, 'outliner', 0, py, pw, ph, 'Outliner');

  const entities = state.world.entities;
  const water = state.world.water;
  const rivers = state.world.rivers;

  if (entities.length === 0 && water.length === 0 && rivers.length === 0) {
    labelSmall(ui, 'Empty world');
    endPanel(ui);
    state.viewportLeft = pw;
    return;
  }

  // Water and rivers first: there are only ever a handful, while a world can
  // have hundreds of entities, and this panel does not scroll yet. Listing them
  // last would put them permanently below the fold and make them unselectable.
  if (water.length > 0) {
    labelSmall(ui, 'Water');
    for (let i = 0; i < water.length; i++) {
      const w = water[i];
      const selected = state.selection.kind === 'water' && state.selection.primary === w.id;
      if (listRow(ui, 'out_water_' + i, w.id, selected, 1)) {
        selectWater(state, w.id);
        syncSelectionOutline(state);
      }
    }
  }

  if (rivers.length > 0) {
    labelSmall(ui, 'Rivers');
    for (let i = 0; i < rivers.length; i++) {
      const r = rivers[i];
      const selected = state.selection.kind === 'river' && state.selection.primary === r.id;
      if (listRow(ui, 'out_river_' + i, r.id, selected, 1)) {
        selectRiver(state, r.id);
        syncSelectionOutline(state);
      }
    }
  }

  if (water.length > 0 || rivers.length > 0) {
    labelSmall(ui, 'Entities');
  }

  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    const selected = state.selection.kind === 'entity' && state.selection.primary === entity.id;
    const indent = entity.prefabRef !== null ? 1 : 0;

    if (listRow(ui, 'out_ent_' + i, entity.name, selected, indent)) {
      state.selection.ids.clear();
      state.selection.ids.add(entity.id);
      selectEntity(state, entity.id);
      syncSelectionOutline(state);
    }
  }

  endPanel(ui);
  state.viewportLeft = pw;
}
