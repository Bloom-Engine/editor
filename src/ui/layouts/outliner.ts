// Left-side outliner: everything in the world, in four sections — water,
// rivers, lights, entities. Clicking selects; the selection carries which
// section it came from, because ids are only unique within their own array.
//
// The list lives in a scroll region (wheel to scroll, thin scrollbar at the
// right edge) with a filter box pinned above it — a world with hundreds of
// entities is unusable without both. Filtering matches name AND id,
// case-insensitive, across every section.

import { getScreenHeight } from 'bloom';
import { UiContext } from '../ui-context';
import {
  beginPanel, endPanel, labelSmall, listRow,
  beginScrollRegion, endScrollRegion,
} from '../widgets';
import { textInput, Ref } from '../text-input';
import { Theme } from '../theme';
import {
  EditorState, selectEntity, selectWater, selectRiver, selectLight,
} from '../../state/editor-state';
import { syncSelectionOutline } from '../../viewport/picking';

// The filter survives across frames (immediate-mode UI has no retained widget
// state) but is intentionally NOT saved anywhere — a stale invisible filter on
// the next launch would read as data loss.
const filterRef: Ref<string> = { value: '' };

function matches(filter: string, name: string, id: string): boolean {
  if (filter.length === 0) return true;
  return name.toLowerCase().indexOf(filter) >= 0 || id.toLowerCase().indexOf(filter) >= 0;
}

export function drawOutliner(ui: UiContext, state: EditorState): void {
  const screenH = getScreenHeight();
  const pw = Theme.outlinerWidth;
  const py = Theme.toolbarHeight;
  const ph = screenH - Theme.toolbarHeight - Theme.statusBarHeight;

  beginPanel(ui, 'outliner', 0, py, pw, ph, 'Outliner');

  // Filter box, pinned above the scrolling list.
  textInput(ui, 'outliner_filter', filterRef, ui.cursorX, ui.cursorY, pw - Theme.padding * 2);
  ui.cursorY += Theme.rowHeight + Theme.spacing;
  const filter = filterRef.value.trim().toLowerCase();

  const entities = state.world.entities;
  const water = state.world.water;
  const rivers = state.world.rivers;
  const lights = state.world.lights;

  if (entities.length === 0 && water.length === 0 && rivers.length === 0 && lights.length === 0) {
    labelSmall(ui, 'Empty world');
    endPanel(ui);
    state.viewportLeft = pw;
    return;
  }

  const listTop = ui.cursorY;
  const listH = py + ph - listTop - Theme.padding;
  beginScrollRegion(ui, 'outliner_list', listTop, listH);

  let shown = 0;

  if (water.length > 0) {
    labelSmall(ui, 'Water');
    for (let i = 0; i < water.length; i++) {
      const w = water[i];
      if (!matches(filter, w.id, w.id)) continue;
      shown++;
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
      if (!matches(filter, r.id, r.id)) continue;
      shown++;
      const selected = state.selection.kind === 'river' && state.selection.primary === r.id;
      if (listRow(ui, 'out_river_' + i, r.id, selected, 1)) {
        selectRiver(state, r.id);
        syncSelectionOutline(state);
      }
    }
  }

  if (lights.length > 0) {
    labelSmall(ui, 'Lights');
    for (let i = 0; i < lights.length; i++) {
      const l = lights[i];
      if (!matches(filter, l.name, l.id)) continue;
      shown++;
      const selected = state.selection.kind === 'light' && state.selection.primary === l.id;
      if (listRow(ui, 'out_light_' + i, l.name, selected, 1)) {
        selectLight(state, l.id);
        syncSelectionOutline(state);
      }
    }
  }

  if (water.length > 0 || rivers.length > 0 || lights.length > 0) {
    labelSmall(ui, 'Entities');
  }

  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    if (!matches(filter, entity.name, entity.id)) continue;
    shown++;
    const selected = state.selection.kind === 'entity' && state.selection.primary === entity.id;
    const indent = entity.prefabRef !== null ? 1 : 0;

    if (listRow(ui, 'out_ent_' + i, entity.name, selected, indent)) {
      state.selection.ids.clear();
      state.selection.ids.add(entity.id);
      selectEntity(state, entity.id);
      syncSelectionOutline(state);
    }
  }

  if (filter.length > 0 && shown === 0) {
    labelSmall(ui, 'No matches');
  }

  endScrollRegion(ui, 'outliner_list');
  endPanel(ui);
  state.viewportLeft = pw;
}
