// In-window text input widget. Consumes characters from getCharPressed()
// and renders an editable text field. Click to focus (the click also places
// the caret), type to edit, Enter to confirm, ESC to cancel.
//
// Full editing model (completed 2026-07-17): caret movement with
// hold-to-repeat (isKeyRepeated), Home/End, Backspace/Delete on both sides,
// insert-at-caret, Ctrl+V/C/X/A, and SELECTION RANGES — Shift+arrows /
// Shift+Home/End extend from an anchor, typing/paste/Backspace/Delete
// replace or remove the selection, Ctrl+C/X copy or cut it (or the whole
// field when nothing is selected).

import {
  drawRect, drawRectLines, drawText, measureText, getCharPressed,
  isKeyPressed, isKeyRepeated, isKeyDown, Key,
  getClipboardText, setClipboardText,
} from 'bloom';
import { UiContext, pointInRect } from './ui-context';
import { Theme } from './theme';

export interface Ref<T> { value: T; }

// Caret + selection state for THE focused field (module scope: only one
// field is focused at a time in an immediate-mode UI, keyed by widget id).
// `selAnchor` is the fixed end of the selection; -1 = no selection.
let caretOwner: string | null = null;
let caret = 0;
let selAnchor = -1;

function hasSelection(): boolean {
  return selAnchor >= 0 && selAnchor !== caret;
}

function selLo(): number { return selAnchor < caret ? selAnchor : caret; }
function selHi(): number { return selAnchor < caret ? caret : selAnchor; }

// Remove the selected range from `text`, park the caret at the cut point.
function deleteSelection(text: string): string {
  const lo = selLo();
  const hi = selHi();
  caret = lo;
  selAnchor = -1;
  return text.substring(0, lo) + text.substring(hi);
}

export function textInput(
  ui: UiContext, id: string, ref: Ref<string>,
  x: number, y: number, w: number,
): boolean {
  const h = Theme.rowHeight;
  const hovered = pointInRect(ui.mouseX, ui.mouseY, x, y, w, h);
  if (hovered) { ui.hotId = id; ui.mouseCaptured = true; }

  const isFocused = ui.activeId === id;

  // Click to focus — and place the caret at the nearest character boundary
  // to the click, so clicking mid-word edits mid-word. A plain click also
  // clears any selection.
  if (hovered && ui.mousePressedLeft) {
    ui.activeId = id;
    ui.mouseCaptured = true;
    caretOwner = id;
    caret = caretIndexAt(ref.value, ui.mouseX - (x + 4));
    selAnchor = -1;
  }

  let changed = false;

  if (isFocused) {
    ui.mouseCaptured = true;

    // A field can also gain focus without a click (rare) — default to end.
    if (caretOwner !== id) {
      caretOwner = id;
      caret = ref.value.length;
      selAnchor = -1;
    }
    if (caret > ref.value.length) caret = ref.value.length;
    if (caret < 0) caret = 0;
    if (selAnchor > ref.value.length) selAnchor = -1;

    const shiftHeld = isKeyDown(Key.LEFT_SHIFT) || isKeyDown(Key.RIGHT_SHIFT);
    const ctrlHeld = isKeyDown(Key.LEFT_CONTROL) || isKeyDown(Key.RIGHT_CONTROL);

    // Selection bookkeeping around caret movement: Shift starts/extends the
    // anchor; movement WITHOUT Shift collapses the selection to the moved-to
    // edge (the standard editor convention).
    const movedLeft = (isKeyPressed(Key.LEFT) || isKeyRepeated(Key.LEFT));
    const movedRight = (isKeyPressed(Key.RIGHT) || isKeyRepeated(Key.RIGHT));
    const movedHome = isKeyPressed(Key.HOME);
    const movedEnd = isKeyPressed(Key.END);
    if ((movedLeft || movedRight || movedHome || movedEnd)) {
      if (shiftHeld) {
        if (selAnchor < 0) selAnchor = caret;
      } else if (hasSelection()) {
        // Collapse: Left/Home land at the low edge, Right/End at the high.
        caret = (movedLeft || movedHome) ? selLo() : selHi();
        selAnchor = -1;
        // The collapse consumed this keypress.
        if (movedHome) caret = 0;
        if (movedEnd) caret = ref.value.length;
        if (caret > ref.value.length) caret = ref.value.length;
        return changed ? true : drawAndReturn(ui, id, ref, x, y, w, h, hovered, isFocused, false);
      } else {
        selAnchor = -1;
      }
    }

    if (movedLeft && caret > 0) caret--;
    if (movedRight && caret < ref.value.length) caret++;
    if (movedHome) caret = 0;
    if (movedEnd) caret = ref.value.length;

    // Delete forward: removes the selection if there is one.
    if (isKeyPressed(Key.DELETE) || isKeyRepeated(Key.DELETE)) {
      if (hasSelection()) {
        ref.value = deleteSelection(ref.value);
        changed = true;
      } else if (caret < ref.value.length) {
        ref.value = ref.value.substring(0, caret) + ref.value.substring(caret + 1);
        changed = true;
      }
    }

    // Clipboard + select-all. Ctrl+C/X act on the selection when one exists,
    // else the whole field; Ctrl+V replaces the selection.
    if (ctrlHeld && isKeyPressed(Key.A)) {
      selAnchor = 0;
      caret = ref.value.length;
    }
    if (ctrlHeld && isKeyPressed(Key.C)) {
      setClipboardText(hasSelection() ? ref.value.substring(selLo(), selHi()) : ref.value);
    }
    if (ctrlHeld && isKeyPressed(Key.X)) {
      if (hasSelection()) {
        setClipboardText(ref.value.substring(selLo(), selHi()));
        ref.value = deleteSelection(ref.value);
      } else {
        setClipboardText(ref.value);
        ref.value = '';
        caret = 0;
      }
      changed = true;
    }
    if (ctrlHeld && isKeyPressed(Key.V)) {
      let paste = getClipboardText();
      paste = paste.split('\r').join('').split('\n').join(' ');
      if (paste.length > 0) {
        if (hasSelection()) ref.value = deleteSelection(ref.value);
        ref.value = ref.value.substring(0, caret) + paste + ref.value.substring(caret);
        caret += paste.length;
        changed = true;
      }
    }

    // Consume characters, inserting at the caret (replacing any selection).
    let c = getCharPressed();
    while (c !== 0) {
      if (c === 8) {
        // Backspace — the selection if any, else the char before the caret.
        if (hasSelection()) {
          ref.value = deleteSelection(ref.value);
          changed = true;
        } else if (caret > 0) {
          ref.value = ref.value.substring(0, caret - 1) + ref.value.substring(caret);
          caret--;
          changed = true;
        }
      } else if (c === 13) {
        // Enter — confirm and defocus.
        ui.activeId = null;
        caretOwner = null;
        selAnchor = -1;
        return true;
      } else if (c >= 32) {
        // Printable character. Ctrl chords already handled above; the ones
        // that reach here as control chars were filtered by c >= 32, but
        // Ctrl+letter also arrives as a char on some layouts — skip those.
        if (!ctrlHeld) {
          if (hasSelection()) ref.value = deleteSelection(ref.value);
          ref.value = ref.value.substring(0, caret) + String.fromCharCode(c) +
            ref.value.substring(caret);
          caret++;
          changed = true;
        }
      }
      c = getCharPressed();
    }

    // ESC cancels focus.
    if (isKeyPressed(Key.ESCAPE)) {
      ui.activeId = null;
      caretOwner = null;
      selAnchor = -1;
    }
  }

  return drawAndReturn(ui, id, ref, x, y, w, h, hovered, isFocused, changed);
}

function drawAndReturn(
  ui: UiContext, id: string, ref: Ref<string>,
  x: number, y: number, w: number, h: number,
  hovered: boolean, isFocused: boolean, changed: boolean,
): boolean {
  const bg = isFocused ? Theme.fieldHover : (hovered ? Theme.fieldHover : Theme.field);
  drawRect(x, y, w, h, bg);
  drawRectLines(x, y, w, h, 1, isFocused ? Theme.textAccent : Theme.border);

  const displayText = ref.value.length > 0 ? ref.value : '';

  // Selection highlight under the text.
  if (isFocused && caretOwner === id && hasSelection()) {
    const loX = measureText(displayText.substring(0, selLo()), Theme.fontSizeSmall);
    const hiX = measureText(displayText.substring(0, selHi()), Theme.fontSizeSmall);
    drawRect(x + 4 + loX, y + 3, hiX - loX, h - 6,
      { r: 70, g: 110, b: 180, a: 160 });
  }

  drawText(displayText, x + 4, y + 5, Theme.fontSizeSmall, Theme.text);

  // Caret when focused, at its actual position in the string.
  if (isFocused && caretOwner === id) {
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
