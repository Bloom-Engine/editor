// Bottom status bar: FPS, mouse world position, selection count, modified flag.

import { drawRect, drawText, getScreenWidth, getScreenHeight, getFPS } from 'bloom';
import { Theme } from '../theme';
import { EditorState } from '../../state/editor-state';

export function drawStatusBar(state: EditorState): void {
  const screenW = getScreenWidth();
  const screenH = getScreenHeight();
  const h = Theme.statusBarHeight;
  const y = screenH - h;

  drawRect(0, y, screenW, h, Theme.panel);

  const ty = y + 5;

  // FPS.
  const fps = (getFPS() | 0).toString();
  drawText('FPS ' + fps, 12, ty, Theme.fontSizeSmall, Theme.textDim);

  // Entity count.
  const count = state.world.entities.length.toString();
  drawText(count + ' entities', 100, ty, Theme.fontSizeSmall, Theme.textDim);

  // Selection count.
  if (state.selection.primary !== null) {
    drawText('selected: ' + state.selection.primary, 220, ty, Theme.fontSizeSmall, Theme.textAccent);
  }

  // Transient message — a refused action has to SAY it was refused.
  if (state.statusMessageT > 0 && state.statusMessage.length > 0) {
    drawText(state.statusMessage, 440, ty, Theme.fontSizeSmall, Theme.textError);
  }

  // Modified indicator.
  if (state.modified) {
    drawText('* modified', screenW - 100, ty, Theme.fontSizeSmall, Theme.textError);
  }

  // Active tool.
  drawText(state.activeTool, screenW - 200, ty, Theme.fontSizeSmall, Theme.textDim);

  state.viewportBottom = y;
}
