// Left-side outliner: flat list of all entities in the world. Clicking selects.

import { getScreenHeight } from 'bloom';
import { UiContext } from '../ui-context';
import { beginPanel, endPanel, labelSmall, listRow } from '../widgets';
import { Theme } from '../theme';
import { EditorState } from '../../state/editor-state';
import { syncSelectionOutline } from '../../viewport/picking';

export function drawOutliner(ui: UiContext, state: EditorState): void {
  const screenH = getScreenHeight();
  const pw = Theme.outlinerWidth;
  const py = Theme.toolbarHeight;
  const ph = screenH - Theme.toolbarHeight - Theme.statusBarHeight;

  beginPanel(ui, 'outliner', 0, py, pw, ph, 'Outliner');

  const entities = state.world.entities;
  if (entities.length === 0) {
    labelSmall(ui, 'No entities');
    endPanel(ui);
    state.viewportLeft = pw;
    return;
  }

  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    const selected = state.selection.primary === entity.id;
    const indent = entity.prefabRef !== null ? 1 : 0;

    if (listRow(ui, 'out_' + i, entity.name, selected, indent)) {
      state.selection.ids.clear();
      state.selection.ids.add(entity.id);
      state.selection.primary = entity.id;
      syncSelectionOutline(state);
    }
  }

  endPanel(ui);
  state.viewportLeft = pw;
}
