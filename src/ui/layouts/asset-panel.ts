// Right-side asset panel: scrollable list of models and prefabs with category
// filters. Clicking a model sets it as the active placement asset.

import { getScreenWidth, getScreenHeight, drawRect, drawRectLines, drawText, drawTexturePro } from 'bloom';
import { UiContext, pointInRect } from '../ui-context';
import {
  beginPanel, endPanel, label, labelSmall, listRow, separator, toolButton, button,
  beginScrollRegion, endScrollRegion,
} from '../widgets';
import { textInput, Ref } from '../text-input';
import { Theme } from '../theme';
import { EditorState } from '../../state/editor-state';
import {
  enterNewPrefabMode, enterPrefabEditMode, exitPrefabMode, savePrefabToDisk,
} from '../../tools/prefab-tool';
import { getThumbnail, THUMB_SIZE } from '../thumbnails';

// The name field for "New Prefab". Module-scope because it must survive between
// frames — an immediate-mode text field with a per-frame Ref forgets what you typed.
const newPrefabName: Ref<string> = { value: '' };

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

  // Model grid: 64px thumbnails (PLAN §G) with the name below each; entries
  // whose thumbnail hasn't rendered yet (or whose model is still streaming
  // in) show a flat placeholder cell. Scrolls like the outliner.
  const cell = 64;
  const cellLabelH = 13;
  const cellH = cell + cellLabelH + 6;
  const cellGap = 6;
  const innerX = panelX + Theme.padding;
  const innerW = panelW - Theme.padding * 2;
  let cols = Math.floor((innerW + cellGap) / (cell + cellGap));
  if (cols < 1) cols = 1;

  const listTop = ui.cursorY;
  const screenH = getScreenHeight();
  const listH = screenH - Theme.statusBarHeight - Theme.padding - listTop;
  beginScrollRegion(ui, 'asset_models', listTop, listH);

  const order = state.catalog.modelOrder;
  let col = 0;
  let rowY = ui.cursorY;
  for (let i = 0; i < order.length; i++) {
    const relPath = order[i];
    const entry = state.catalog.models.get(relPath);
    if (!entry) continue;
    if (state.catalog.activeCategory !== 'all' && entry.category !== state.catalog.activeCategory) {
      continue;
    }

    const x = innerX + col * (cell + cellGap);
    const visible = rowY >= ui.clipTop && rowY + cellH <= ui.clipBottom;

    if (visible) {
      const hovered = pointInRect(ui.mouseX, ui.mouseY, x, rowY, cell, cellH);
      if (hovered) {
        ui.hotId = 'model_' + i;
        ui.mouseCaptured = true;
        if (ui.mousePressedLeft) {
          state.placeAssetRef = relPath;
          state.activeTool = 'place';
        }
      }

      const thumb = entry.loaded ? getThumbnail(relPath) : null;
      if (thumb !== null && thumb.textureHandle !== 0) {
        drawTexturePro(
          { handle: thumb.textureHandle, width: THUMB_SIZE, height: THUMB_SIZE },
          { x: 0, y: 0, width: THUMB_SIZE, height: THUMB_SIZE },
          { x: x, y: rowY, width: cell, height: cell },
          { x: 0, y: 0 }, 0,
          { r: 255, g: 255, b: 255, a: 255 },
        );
      } else {
        drawRect(x, rowY, cell, cell, Theme.field);
        drawText(entry.loaded ? '…' : '·', x + cell / 2 - 3, rowY + cell / 2 - 8,
          Theme.fontSize, Theme.textDim);
      }

      const selected = state.placeAssetRef === relPath;
      if (selected || hovered) {
        drawRectLines(x, rowY, cell, cell, 1, selected ? Theme.textAccent : Theme.border);
      }

      let name = entry.displayName;
      if (name.length > 10) name = name.substring(0, 9) + '…';
      drawText(name, x, rowY + cell + 2, Theme.fontSizeSmall, Theme.textDim);
    }

    col++;
    if (col >= cols) {
      col = 0;
      rowY += cellH;
    }
  }
  // Account for a partially filled final row.
  ui.cursorY = col === 0 ? rowY : rowY + cellH;

  endScrollRegion(ui, 'asset_models');
}

function drawPrefabList(
  ui: UiContext, state: EditorState,
  panelX: number, panelW: number,
): void {
  // While a prefab is open, this tab is where you get OUT of it — offering to open a
  // second one from inside the first is how you lose work.
  if (state.editingPrefab) {
    labelSmall(ui, 'Editing: ' + state.editingPrefab.name);
    labelSmall(ui, 'Place parts from the Models tab.');
    ui.cursorY += Theme.spacing;
    if (button(ui, 'prefab_save', 'Save Prefab  (Ctrl+S)')) savePrefabToDisk(state);
    if (button(ui, 'prefab_exit', 'Exit  (ESC)')) exitPrefabMode(state);
    return;
  }

  // --- New prefab: name field + button.
  const fieldW = panelW - Theme.padding * 2;
  textInput(ui, 'new_prefab_name', newPrefabName, ui.cursorX, ui.cursorY, fieldW);
  ui.cursorY += Theme.rowHeight + Theme.spacing;

  const nm = newPrefabName.value.trim();
  if (button(ui, 'new_prefab', '+ New Prefab')) {
    // An unnamed prefab is a file you will never find again. Fall back to a
    // sequential name rather than refusing the click and saying nothing.
    const name = nm.length > 0 ? nm : ('prefab_' + (state.catalog.prefabOrder.length + 1));
    enterNewPrefabMode(state, slugify(name), name);
    newPrefabName.value = '';
  }

  separator(ui);

  const order = state.catalog.prefabOrder;
  if (order.length === 0) {
    labelSmall(ui, 'No prefabs yet.');
    labelSmall(ui, 'Name one above and hit + New Prefab.');
    return;
  }

  let selectedId: string | null = null;
  for (let i = 0; i < order.length; i++) {
    const prefabId = order[i];
    const prefab = state.catalog.prefabs.get(prefabId);
    if (!prefab) continue;

    const selected = state.placeAssetRef === 'prefab:' + prefabId;
    if (selected) selectedId = prefabId;
    const n = prefab.children.length;
    const rowText = prefab.name + '  (' + n + ')';
    if (listRow(ui, 'prefab_' + i, rowText, selected, 0)) {
      state.placeAssetRef = 'prefab:' + prefabId;
      state.activeTool = 'place';
      selectedId = prefabId;
    }
  }

  // Edit the selected one. (No double-click: the UI context has no notion of one,
  // and inventing a hidden gesture is worse than a visible button.)
  if (selectedId !== null) {
    ui.cursorY += Theme.spacing;
    const p = state.catalog.prefabs.get(selectedId);
    const label2 = 'Edit "' + (p ? p.name : selectedId) + '"';
    if (button(ui, 'edit_prefab', label2)) enterPrefabEditMode(state, selectedId);
  }
}

/// Lowercase, non-alphanumerics to underscores — this becomes a filename and a
/// stable id that world files reference by string.
function slugify(name: string): string {
  let out = '';
  const lower = name.toLowerCase();
  for (let i = 0; i < lower.length; i++) {
    const c = lower.charAt(i);
    const code = lower.charCodeAt(i);
    const isNum = code >= 48 && code <= 57;
    const isAlpha = code >= 97 && code <= 122;
    out = out + (isNum || isAlpha ? c : '_');
  }
  return out.length > 0 ? out : 'prefab';
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
