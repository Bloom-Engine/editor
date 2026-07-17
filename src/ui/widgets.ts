// Immediate-mode UI widgets built on Bloom's drawRect/drawText/measureText.
//
// Every widget takes a stable string `id` for hit/active tracking and returns
// a boolean indicating whether the user interacted (clicked, changed value).
// Layout is manual — the caller sets the UiContext cursor position or passes
// explicit coordinates.

import {
  drawRect, drawRectLines, drawText, measureText, drawLine,
} from 'bloom';
import { UiContext, pointInRect } from './ui-context';
import { Theme, UiColor } from './theme';
import { Vec3Lit } from 'bloom/world';

export interface Ref<T> { value: T; }

// ---- Panel -----------------------------------------------------------------

export function beginPanel(
  ui: UiContext, id: string,
  x: number, y: number, w: number, h: number,
  title?: string,
): void {
  drawRect(x, y, w, h, Theme.panel);
  drawRectLines(x, y, w, h, 1, Theme.border);

  ui.panelX = x;
  ui.panelY = y;
  ui.panelW = w;
  ui.panelH = h;
  ui.cursorX = x + Theme.padding;
  ui.clipTop = y;
  ui.clipBottom = y + h;

  if (title) {
    ui.cursorY = y + Theme.padding;
    drawText(title, ui.cursorX, ui.cursorY, Theme.fontSizeSmall, Theme.textDim);
    ui.cursorY += Theme.fontSizeSmall + Theme.spacing;
  } else {
    ui.cursorY = y + Theme.spacing;
  }

  // Capture mouse if it's over this panel.
  if (pointInRect(ui.mouseX, ui.mouseY, x, y, w, h)) {
    ui.mouseCaptured = true;
  }
}

export function endPanel(_ui: UiContext): void {
  // Placeholder for future scrollbar / clip-region cleanup.
}

// True when a widget spanning [y, y+h] pokes outside the current clip window.
// Skipped widgets still advance the layout cursor, so scrolled-out rows keep
// their place; they just neither draw nor hit-test.
function clipped(ui: UiContext, y: number, h: number): boolean {
  return y < ui.clipTop || y + h > ui.clipBottom;
}

// ---- Scroll region -----------------------------------------------------------
//
// A vertically scrollable strip INSIDE the current panel (never nested). Rows
// drawn between begin/end are offset by the stored scroll and clipped to the
// region; the mouse wheel scrolls while the pointer is over it. endScrollRegion
// measures the content, clamps the offset, and draws a thin scrollbar when the
// content overflows. Offsets persist in ui.scrollOffsets keyed by `id`.

export function beginScrollRegion(ui: UiContext, id: string, top: number, height: number): void {
  const stored = ui.scrollOffsets.get(id);
  const scroll = stored !== undefined ? stored : 0;

  ui.scrollRegionTop = top;
  ui.scrollRegionH = height;
  ui.clipTop = top;
  ui.clipBottom = top + height;
  ui.cursorY = top - scroll;

  if (ui.mouseWheel !== 0 &&
      pointInRect(ui.mouseX, ui.mouseY, ui.panelX, top, ui.panelW, height)) {
    // Wheel-up (positive) scrolls toward the top. Clamped in endScrollRegion,
    // once the content height is known.
    ui.scrollOffsets.set(id, scroll - ui.mouseWheel * Theme.rowHeight * 3);
    ui.mouseCaptured = true;
  }
}

export function endScrollRegion(ui: UiContext, id: string): void {
  const stored = ui.scrollOffsets.get(id);
  const scroll = stored !== undefined ? stored : 0;
  const contentH = (ui.cursorY + scroll) - ui.scrollRegionTop;

  let maxScroll = contentH - ui.scrollRegionH;
  if (maxScroll < 0) maxScroll = 0;
  let clampedScroll = scroll;
  if (clampedScroll < 0) clampedScroll = 0;
  if (clampedScroll > maxScroll) clampedScroll = maxScroll;
  if (clampedScroll !== scroll) ui.scrollOffsets.set(id, clampedScroll);

  if (contentH > ui.scrollRegionH && maxScroll > 0) {
    const trackX = ui.panelX + ui.panelW - 4;
    let thumbH = ui.scrollRegionH * (ui.scrollRegionH / contentH);
    if (thumbH < 20) thumbH = 20;
    const thumbY = ui.scrollRegionTop +
      (ui.scrollRegionH - thumbH) * (clampedScroll / maxScroll);
    drawRect(trackX, ui.scrollRegionTop, 3, ui.scrollRegionH, Theme.border);
    drawRect(trackX, thumbY, 3, thumbH, Theme.textDim);
  }

  // Restore the panel-wide clip and park the cursor below the region.
  ui.clipTop = ui.panelY;
  ui.clipBottom = ui.panelY + ui.panelH;
  ui.cursorY = ui.scrollRegionTop + ui.scrollRegionH;
}

// ---- Label -----------------------------------------------------------------

export function label(ui: UiContext, text: string, color?: UiColor): void {
  const c = color ? color : Theme.text;
  if (!clipped(ui, ui.cursorY, Theme.fontSize)) {
    drawText(text, ui.cursorX, ui.cursorY, Theme.fontSize, c);
  }
  ui.cursorY += Theme.fontSize + Theme.spacing;
}

export function labelSmall(ui: UiContext, text: string, color?: UiColor): void {
  const c = color ? color : Theme.textDim;
  if (!clipped(ui, ui.cursorY, Theme.fontSizeSmall)) {
    drawText(text, ui.cursorX, ui.cursorY, Theme.fontSizeSmall, c);
  }
  ui.cursorY += Theme.fontSizeSmall + Theme.spacing;
}

// ---- Separator -------------------------------------------------------------

export function separator(ui: UiContext): void {
  if (clipped(ui, ui.cursorY, Theme.spacing * 3)) {
    ui.cursorY += Theme.spacing * 3;
    return;
  }
  const y = ui.cursorY + Theme.spacing;
  // drawLine takes (x1, y1, x2, y2, thickness, Color) — pass the Color object,
  // not its four channels. Splatting the channels made the engine read `.r`
  // off a number, yielding undefined and a native-ABI TypeError.
  drawLine(
    ui.panelX + Theme.padding, y,
    ui.panelX + ui.panelW - Theme.padding, y,
    1, Theme.border,
  );
  ui.cursorY = y + Theme.spacing * 2;
}

// ---- Button ----------------------------------------------------------------

export function button(
  ui: UiContext, id: string, text: string, w?: number,
): boolean {
  const bw = w !== undefined ? w : ui.panelW - Theme.padding * 2;
  const bh = Theme.buttonHeight;
  const bx = ui.cursorX;
  const by = ui.cursorY;

  if (clipped(ui, by, bh)) {
    ui.cursorY += bh + Theme.spacing;
    return false;
  }

  const hovered = pointInRect(ui.mouseX, ui.mouseY, bx, by, bw, bh);
  if (hovered) ui.hotId = id;

  let clicked = false;
  if (hovered && ui.mousePressedLeft) { ui.activeId = id; }
  if (ui.activeId === id && ui.mouseReleasedLeft) {
    if (hovered) { clicked = true; ui.mouseCaptured = true; }
    ui.activeId = null;
  }

  const bg = ui.activeId === id ? Theme.buttonActive
    : hovered ? Theme.buttonHover
    : Theme.button;
  drawRect(bx, by, bw, bh, bg);

  const tw = measureText(text, Theme.fontSize);
  drawText(text, bx + (bw - tw) / 2, by + 5, Theme.fontSize, Theme.text);

  ui.cursorY += bh + Theme.spacing;
  return clicked;
}

// ---- Toggle Button ---------------------------------------------------------

export function toggleButton(
  ui: UiContext, id: string, text: string, value: boolean, w?: number,
): boolean {
  const bw = w !== undefined ? w : ui.panelW - Theme.padding * 2;
  const bh = Theme.buttonHeight;
  const bx = ui.cursorX;
  const by = ui.cursorY;

  if (clipped(ui, by, bh)) {
    ui.cursorY += bh + Theme.spacing;
    return false;
  }

  const hovered = pointInRect(ui.mouseX, ui.mouseY, bx, by, bw, bh);
  if (hovered) ui.hotId = id;

  let clicked = false;
  if (hovered && ui.mousePressedLeft) { ui.activeId = id; }
  if (ui.activeId === id && ui.mouseReleasedLeft) {
    if (hovered) { clicked = true; ui.mouseCaptured = true; }
    ui.activeId = null;
  }

  const bg = value ? Theme.buttonSelected
    : hovered ? Theme.buttonHover
    : Theme.button;
  drawRect(bx, by, bw, bh, bg);

  const tw = measureText(text, Theme.fontSize);
  drawText(text, bx + (bw - tw) / 2, by + 5, Theme.fontSize, Theme.text);

  ui.cursorY += bh + Theme.spacing;
  return clicked;
}

// ---- Inline tool button (fixed width, does not advance cursorY) ------------

export function toolButton(
  ui: UiContext, id: string, text: string,
  x: number, y: number, w: number, active: boolean,
): boolean {
  const h = Theme.buttonHeight;
  const hovered = pointInRect(ui.mouseX, ui.mouseY, x, y, w, h);
  if (hovered) { ui.hotId = id; ui.mouseCaptured = true; }

  let clicked = false;
  if (hovered && ui.mousePressedLeft) { ui.activeId = id; }
  if (ui.activeId === id && ui.mouseReleasedLeft) {
    if (hovered) { clicked = true; ui.mouseCaptured = true; }
    ui.activeId = null;
  }

  const bg = active ? Theme.buttonSelected
    : hovered ? Theme.buttonHover
    : Theme.button;
  drawRect(x, y, w, h, bg);

  const tw = measureText(text, Theme.fontSizeSmall);
  drawText(text, x + (w - tw) / 2, y + 6, Theme.fontSizeSmall, Theme.text);

  return clicked;
}

// ---- List Row (for asset panel + outliner) ---------------------------------

export function listRow(
  ui: UiContext, id: string, text: string,
  selected: boolean, indent: number,
): boolean {
  const rh = Theme.rowHeight;
  const rx = ui.panelX;
  const rw = ui.panelW;
  const ry = ui.cursorY;

  if (clipped(ui, ry, rh)) {
    // Outside the clip window (scrolled out) — skip drawing but still advance
    // the cursor so the scroll region measures true content height.
    ui.cursorY += rh;
    return false;
  }

  const hovered = pointInRect(ui.mouseX, ui.mouseY, rx, ry, rw, rh);
  if (hovered) { ui.hotId = id; ui.mouseCaptured = true; }

  let clicked = false;
  if (hovered && ui.mousePressedLeft) {
    clicked = true;
    ui.mouseCaptured = true;
  }

  if (selected) {
    drawRect(rx, ry, rw, rh, Theme.selected);
  } else if (hovered) {
    drawRect(rx, ry, rw, rh, Theme.panelHover);
  }

  const textX = rx + Theme.padding + indent * 12;
  drawText(text, textX, ry + 5, Theme.fontSize, Theme.text);

  ui.cursorY += rh;
  return clicked;
}

// ---- DragFloat (Blender-style click-drag numeric input) --------------------

export function dragFloat(
  ui: UiContext, id: string, labelText: string,
  ref: Ref<number>,
  step: number, min: number, max: number,
  fieldWidth?: number,
): boolean {
  const fw = fieldWidth !== undefined ? fieldWidth : 80;
  const totalW = ui.panelW - Theme.padding * 2;
  const labelW = totalW - fw - Theme.spacing;
  const fx = ui.cursorX + labelW + Theme.spacing;
  const fy = ui.cursorY;
  const fh = Theme.rowHeight;

  // Label.
  drawText(labelText, ui.cursorX, fy + 4, Theme.fontSizeSmall, Theme.textDim);

  // Field background.
  const hovered = pointInRect(ui.mouseX, ui.mouseY, fx, fy, fw, fh);
  if (hovered) { ui.hotId = id; ui.mouseCaptured = true; }

  let changed = false;

  if (hovered && ui.mousePressedLeft) {
    ui.activeId = id;
    ui.dragStartValue = ref.value;
    ui.dragStartX = ui.mouseX;
  }

  if (ui.activeId === id) {
    ui.mouseCaptured = true;
    if (ui.mouseDownLeft) {
      const dx = ui.mouseX - ui.dragStartX;
      let speed = step;
      // TODO: check Shift/Alt modifiers for fine/coarse dragging once Q3 lands.
      ref.value = ui.dragStartValue + dx * speed;
      if (ref.value < min) ref.value = min;
      if (ref.value > max) ref.value = max;
      changed = true;
    } else {
      ui.activeId = null;
    }
  }

  const bg = ui.activeId === id ? Theme.fieldHover
    : hovered ? Theme.fieldHover
    : Theme.field;
  drawRect(fx, fy, fw, fh, bg);

  // Display value truncated to 2 decimal places.
  const valStr = (Math.round(ref.value * 100) / 100).toString();
  drawText(valStr, fx + 4, fy + 5, Theme.fontSizeSmall, Theme.text);

  ui.cursorY += fh + Theme.spacing;
  return changed;
}

// ---- Vec3 field (three dragFloats in a row) --------------------------------

export function vec3Field(
  ui: UiContext, id: string, labelText: string,
  ref: Ref<Vec3Lit>,
): boolean {
  drawText(labelText, ui.cursorX, ui.cursorY, Theme.fontSizeSmall, Theme.textDim);
  ui.cursorY += Theme.fontSizeSmall + Theme.spacing;

  const fw = (ui.panelW - Theme.padding * 2 - Theme.spacing * 2) / 3;
  const baseX = ui.cursorX;
  const fy = ui.cursorY;
  const fh = Theme.rowHeight;

  let changed = false;

  // X
  const xRef: Ref<number> = { value: ref.value[0] };
  changed = drawInlineFloat(ui, id + '_x', xRef, fw, baseX, fy, fh, Theme.axisX) || changed;
  if (changed) ref.value[0] = xRef.value;

  // Y
  const yRef: Ref<number> = { value: ref.value[1] };
  changed = drawInlineFloat(ui, id + '_y', yRef, fw, baseX + fw + Theme.spacing, fy, fh, Theme.axisY) || changed;
  if (changed) ref.value[1] = yRef.value;

  // Z
  const zRef: Ref<number> = { value: ref.value[2] };
  changed = drawInlineFloat(ui, id + '_z', zRef, fw, baseX + (fw + Theme.spacing) * 2, fy, fh, Theme.axisZ) || changed;
  if (changed) ref.value[2] = zRef.value;

  ui.cursorY += fh + Theme.spacing;
  return changed;
}

function drawInlineFloat(
  ui: UiContext, id: string, ref: Ref<number>,
  w: number, x: number, y: number, h: number,
  accentColor: UiColor,
): boolean {
  const hovered = pointInRect(ui.mouseX, ui.mouseY, x, y, w, h);
  if (hovered) { ui.hotId = id; ui.mouseCaptured = true; }

  let changed = false;

  if (hovered && ui.mousePressedLeft) {
    ui.activeId = id;
    ui.dragStartValue = ref.value;
    ui.dragStartX = ui.mouseX;
  }

  if (ui.activeId === id) {
    ui.mouseCaptured = true;
    if (ui.mouseDownLeft) {
      const dx = ui.mouseX - ui.dragStartX;
      ref.value = ui.dragStartValue + dx * 0.05;
      changed = true;
    } else {
      ui.activeId = null;
    }
  }

  const bg = ui.activeId === id || hovered ? Theme.fieldHover : Theme.field;
  drawRect(x, y, w, h, bg);
  // Color accent bar at the left edge.
  drawRect(x, y, 3, h, accentColor);

  const valStr = (Math.round(ref.value * 100) / 100).toString();
  drawText(valStr, x + 6, y + 5, Theme.fontSizeSmall, Theme.text);

  return changed;
}
