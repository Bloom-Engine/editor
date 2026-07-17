// In-window text input widget. Consumes characters from getCharPressed()
// and renders an editable text field. Click to focus (the click also places
// the caret), type to edit, Enter to confirm, ESC to cancel.
//
// Caret editing (2026-07-17): Left/Right move (with hold-to-repeat via
// isKeyRepeated), Home/End jump, Backspace deletes before the caret, Delete
// after it, typing inserts AT the caret, Ctrl+V pastes at the caret, and
// Ctrl+C copies the whole field (no selection ranges yet — the one piece
// still missing).

import {
  drawRect, drawRectLines, drawText, measureText, getCharPressed,
  isKeyPressed, isKeyRepeated, isKeyDown, Key,
  getClipboardText, setClipboardText,
} from 'bloom';
import { UiContext, pointInRect } from './ui-context';
import { Theme } from './theme';

export interface Ref<T> { value: T; }

// Caret state for THE focused field (module scope: only one field is focused
// at a time in an immediate-mode UI, keyed by widget id).
let caretOwner: string | null = null;
let caret = 0;

export function textInput(
  ui: UiContext, id: string, ref: Ref<string>,
  x: number, y: number, w: number,
): boolean {
  const h = Theme.rowHeight;
  const hovered = pointInRect(ui.mouseX, ui.mouseY, x, y, w, h);
  if (hovered) { ui.hotId = id; ui.mouseCaptured = true; }

  const isFocused = ui.activeId === id;

  // Click to focus — and place the caret at the nearest character boundary
  // to the click, so clicking mid-word edits mid-word.
  if (hovered && ui.mousePressedLeft) {
    ui.activeId = id;
    ui.mouseCaptured = true;
    caretOwner = id;
    caret = caretIndexAt(ref.value, ui.mouseX - (x + 4));
  }

  let changed = false;

  if (isFocused) {
    ui.mouseCaptured = true;

    // A field can also gain focus without a click (rare) — default to end.
    if (caretOwner !== id) {
      caretOwner = id;
      caret = ref.value.length;
    }
    if (caret > ref.value.length) caret = ref.value.length;
    if (caret < 0) caret = 0;

    // Caret movement first, so a movement key pressed the same frame as a
    // character applies to the pre-insert text predictably. `|| isKeyRepeated`
    // gives hold-to-repeat without touching isKeyPressed semantics.
    if ((isKeyPressed(Key.LEFT) || isKeyRepeated(Key.LEFT)) && caret > 0) caret--;
    if ((isKeyPressed(Key.RIGHT) || isKeyRepeated(Key.RIGHT)) && caret < ref.value.length) caret++;
    if (isKeyPressed(Key.HOME)) caret = 0;
    if (isKeyPressed(Key.END)) caret = ref.value.length;
    if ((isKeyPressed(Key.DELETE) || isKeyRepeated(Key.DELETE)) && caret < ref.value.length) {
      ref.value = ref.value.substring(0, caret) + ref.value.substring(caret + 1);
      changed = true;
    }

    // Clipboard. Ctrl+V pastes at the caret (newlines flattened — these are
    // single-line fields for names and paths); Ctrl+C copies the whole field
    // (no selection ranges yet).
    const ctrlHeld = isKeyDown(Key.LEFT_CONTROL) || isKeyDown(Key.RIGHT_CONTROL);
    if (ctrlHeld && isKeyPressed(Key.V)) {
      let paste = getClipboardText();
      paste = paste.split('\r').join('').split('\n').join(' ');
      if (paste.length > 0) {
        ref.value = ref.value.substring(0, caret) + paste + ref.value.substring(caret);
        caret += paste.length;
        changed = true;
      }
    }
    if (ctrlHeld && isKeyPressed(Key.C)) {
      setClipboardText(ref.value);
    }

    // Consume characters, inserting at the caret.
    let c = getCharPressed();
    while (c !== 0) {
      if (c === 8) {
        // Backspace — delete before the caret.
        if (caret > 0) {
          ref.value = ref.value.substring(0, caret - 1) + ref.value.substring(caret);
          caret--;
          changed = true;
        }
      } else if (c === 13) {
        // Enter — confirm and defocus.
        ui.activeId = null;
        caretOwner = null;
        return true;
      } else if (c >= 32) {
        // Printable character.
        ref.value = ref.value.substring(0, caret) + String.fromCharCode(c) +
          ref.value.substring(caret);
        caret++;
        changed = true;
      }
      c = getCharPressed();
    }

    // ESC cancels focus.
    if (isKeyPressed(Key.ESCAPE)) {
      ui.activeId = null;
      caretOwner = null;
    }
  }

  // Draw.
  const bg = isFocused ? Theme.fieldHover : (hovered ? Theme.fieldHover : Theme.field);
  drawRect(x, y, w, h, bg);
  drawRectLines(x, y, w, h, 1, isFocused ? Theme.textAccent : Theme.border);

  const displayText = ref.value.length > 0 ? ref.value : '';
  drawText(displayText, x + 4, y + 5, Theme.fontSizeSmall, Theme.text);

  // Caret when focused, at its actual position in the string.
  if (isFocused) {
    const prefix = displayText.substring(0, caret);
    const caretX = x + 4 + measureText(prefix, Theme.fontSizeSmall);
    drawRect(caretX, y + 4, 1, h - 8, Theme.textAccent);
  }

  return changed;
}

// Character boundary nearest to a pixel offset into the text. Linear scan —
// these fields hold names and paths, not documents.
function caretIndexAt(text: string, px: number): number {
  if (px <= 0) return 0;
  for (let i = 1; i <= text.length; i++) {
    const wPrefix = measureText(text.substring(0, i), Theme.fontSizeSmall);
    if (wPrefix > px) {
      // Closer to the previous boundary or this one?
      const wPrev = measureText(text.substring(0, i - 1), Theme.fontSizeSmall);
      return (px - wPrev) < (wPrefix - px) ? i - 1 : i;
    }
  }
  return text.length;
}
