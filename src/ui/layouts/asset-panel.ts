// Right-side asset panel: scrollable list of models and prefabs with category
// filters. Clicking a model sets it as the active placement asset.

import { getScreenWidth, getScreenHeight } from 'bloom';
import { UiContext } from '../ui-context';
import { beginPanel, endPanel, label, labelSmall, listRow, separator, toolButton } from '../widgets';
import { Theme } from '../theme';
import { EditorState } from '../../state/editor-state';

export function drawAssetPanel(ui: UiContext, state: EditorState): void {
  const screenW = getScreenWidth();
  const screenH = getScreenHeight();
  const pw = Theme.assetPanelWidth;
  const px = screenW - pw;
  const py = Theme.toolbarHeight;
  const ph = screenH - Theme.toolbarHeight - Theme.statusBarHeight;

  beginPanel(ui, 'asset_panel', px, py, pw, ph, 'Assets');

  // Tab bar: Models | Prefabs.
  const tabY = ui.cursorY;
  const tabW = (pw - Theme.padding * 3) / 2;
  if (toolButton(ui, 'tab_models', 'Models', px + Theme.padding, tabY, tabW, state.catalog.activeTab === 0)) {
    state.catalog.activeTab = 0;
  }
  if (toolButton(ui, 'tab_prefabs', 'Prefabs', px + Theme.padding + tabW + Theme.spacing, tabY, tabW, state.catalog.activeTab === 1)) {
    state.catalog.activeTab = 1;
  }
  ui.cursorY = tabY + Theme.buttonHeight + Theme.spacing;

  separator(ui);

  if (state.catalog.activeTab === 0) {
    drawModelList(ui, state, px, pw, ph);
  } else {
    drawPrefabList(ui, state, px, pw);
  }

  endPanel(ui);

  // Update the viewport right edge.
  state.viewportRight = px;
}

function drawModelList(
  ui: UiContext, state: EditorState,
  panelX: number, panelW: number, panelH: number,
): void {
  // Category filter buttons.
  const categories = collectCategories(state);
  const catY = ui.cursorY;
  let cx = ui.cursorX;
  const catBw = 40;

  if (toolButton(ui, 'cat_all', 'All', cx, catY, catBw, state.catalog.activeCategory === 'all')) {
    state.catalog.activeCategory = 'all';
  }
  cx += catBw + 2;

  for (let i = 0; i < categories.length; i++) {
    const cat = categories[i];
    const shortName = cat.length > 4 ? cat.substring(0, 4) : cat;
    if (toolButton(ui, 'cat_' + cat, shortName, cx, catY, catBw, state.catalog.activeCategory === cat)) {
      state.catalog.activeCategory = cat;
    }
    cx += catBw + 2;
    if (cx > panelX + panelW - catBw) {
      cx = ui.cursorX;
      ui.cursorY += Theme.buttonHeight + 2;
    }
  }
  ui.cursorY = catY + Theme.buttonHeight + Theme.spacing;

  separator(ui);

  // Model list.
  const order = state.catalog.modelOrder;
  for (let i = 0; i < order.length; i++) {
    const relPath = order[i];
    const entry = state.catalog.models.get(relPath);
    if (!entry) continue;
    if (state.catalog.activeCategory !== 'all' && entry.category !== state.catalog.activeCategory) {
      continue;
    }

    const selected = state.placeAssetRef === relPath;
    if (listRow(ui, 'model_' + i, entry.displayName, selected, 0)) {
      state.placeAssetRef = relPath;
      state.activeTool = 'place';
    }
  }
}

function drawPrefabList(
  ui: UiContext, state: EditorState,
  panelX: number, panelW: number,
): void {
  const order = state.catalog.prefabOrder;
  if (order.length === 0) {
    labelSmall(ui, 'No prefabs found');
    return;
  }
  for (let i = 0; i < order.length; i++) {
    const prefabId = order[i];
    const prefab = state.catalog.prefabs.get(prefabId);
    if (!prefab) continue;

    const selected = state.placeAssetRef === 'prefab:' + prefabId;
    if (listRow(ui, 'prefab_' + i, prefab.name, selected, 0)) {
      state.placeAssetRef = 'prefab:' + prefabId;
      state.activeTool = 'place';
    }
  }
}

function collectCategories(state: EditorState): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = 0; i < state.catalog.modelOrder.length; i++) {
    const entry = state.catalog.models.get(state.catalog.modelOrder[i]);
    if (entry && !seen.has(entry.category)) {
      seen.add(entry.category);
      out.push(entry.category);
    }
  }
  return out;
}
