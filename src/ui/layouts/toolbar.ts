// Top toolbar: File actions (New, Open, Save) + tool selection buttons.

import { drawRect, getScreenWidth } from 'bloom';
import { UiContext } from '../ui-context';
import { toolButton } from '../widgets';
import { Theme } from '../theme';
import { EditorState, ToolId } from '../../state/editor-state';
import { newWorld, saveCurrentWorld, defaultSavePath } from '../../io/world-io';
import { showOpenWorldDialog, showSaveWorldDialog } from '../dialogs';

export function drawToolbar(ui: UiContext, state: EditorState): void {
  const screenW = getScreenWidth();
  const h = Theme.toolbarHeight;
  drawRect(0, 0, screenW, h, Theme.panel);

  const y = 5;
  let x = 8;
  const bw = 48;
  const gap = 4;

  // File actions.
  if (toolButton(ui, 'tb_new', 'New', x, y, bw, false)) {
    newWorld(state);
  }
  x += bw + gap;

  if (toolButton(ui, 'tb_open', 'Open', x, y, bw, false)) {
    showOpenWorldDialog(state);
  }
  x += bw + gap;

  if (toolButton(ui, 'tb_save', 'Save', x, y, bw, false)) {
    if (state.worldPath) {
      saveCurrentWorld(state);
    } else {
      showSaveWorldDialog(state);
    }
  }
  x += bw + gap + 12; // Extra gap before tool buttons.

  // Separator.
  drawRect(x, y + 2, 1, Theme.buttonHeight - 4, Theme.border);
  x += 8;

  // Tool buttons. Water/river were reachable only by hotkey (T/Y) before.
  const tools: [ToolId, string][] = [
    ['select', 'Sel'],
    ['place', 'Place'],
    ['transform', 'Move'],
    ['brush', 'Brush'],
    ['water', 'Water'],
    ['river', 'River'],
  ];
  for (let i = 0; i < tools.length; i++) {
    const [tid, lbl] = tools[i];
    if (toolButton(ui, 'tb_tool_' + tid, lbl, x, y, bw, state.activeTool === tid)) {
      state.activeTool = tid;
    }
    x += bw + gap;
  }

  // Transform mode sub-buttons (only visible when transform tool active).
  if (state.activeTool === 'transform') {
    x += 4;
    const modes: ['move' | 'rotate' | 'scale', string][] = [
      ['move', 'G'],
      ['rotate', 'R'],
      ['scale', 'S'],
    ];
    for (let i = 0; i < modes.length; i++) {
      const [mode, lbl] = modes[i];
      if (toolButton(ui, 'tb_mode_' + mode, lbl, x, y, 28, state.transformMode === mode)) {
        state.transformMode = mode;
      }
      x += 28 + gap;
    }
  }

  // Modified indicator.
  if (state.modified) {
    drawRect(screenW - 20, y + 8, 8, 8, Theme.textAccent);
  }
}
