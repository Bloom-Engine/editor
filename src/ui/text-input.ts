// In-window text input widget. Consumes characters from getCharPressed()
// and renders an editable text field. Click to focus, type to edit,
// Enter to confirm, ESC to cancel.

import { drawRect, drawRectLines, drawText, measureText, getCharPressed, isKeyPressed, Key } from 'bloom';
import { UiContext, pointInRect } from './ui-context';
import { Theme } from './theme';

export interface Ref<T> { value: T; }

export function textInput(
  ui: UiContext, id: string, ref: Ref<string>,
  x: number, y: number, w: number,
): boolean {
  const h = Theme.rowHeight;
  const hovered = pointInRect(ui.mouseX, ui.mouseY, x, y, w, h);
  if (hovered) { ui.hotId = id; ui.mouseCaptured = true; }

  const isFocused = ui.activeId === id;

  // Click to focus.
  if (hovered && ui.mousePressedLeft) {
    ui.activeId = id;
    ui.mouseCaptured = true;
  }

  let changed = false;

  if (isFocused) {
    ui.mouseCaptured = true;

    // Consume characters.
    let c = getCharPressed();
    while (c !== 0) {
      if (c === 8) {
        // Backspace.
        if (ref.value.length > 0) {
          ref.value = ref.value.substring(0, ref.value.length - 1);
          changed = true;
        }
      } else if (c === 13) {
        // Enter — confirm and defocus.
        ui.activeId = null;
        return true;
      } else if (c >= 32) {
        // Printable character.
        ref.value = ref.value + String.fromCharCode(c);
        changed = true;
      }
      c = getCharPressed();
    }

    // ESC cancels focus.
    if (isKeyPressed(Key.Escape)) {
      ui.activeId = null;
    }
  }

  // Draw.
  const bg = isFocused ? Theme.fieldHover : (hovered ? Theme.fieldHover : Theme.field);
  drawRect(x, y, w, h, bg);
  drawRectLines(x, y, w, h, 1, isFocused ? Theme.textAccent : Theme.border);

  const displayText = ref.value.length > 0 ? ref.value : '';
  drawText(displayText, x + 4, y + 5, Theme.fontSizeSmall, Theme.text);

  // Blinking cursor when focused.
  if (isFocused) {
    const cursorX = x + 4 + measureText(displayText, Theme.fontSizeSmall);
    drawRect(cursorX, y + 4, 1, h - 8, Theme.textAccent);
  }

  return changed;
}
