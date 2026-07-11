// Right-bottom property inspector: shows transform, name, tags, and the
// userData key/value table for the selected entity. Transform fields use
// dragFloat (Blender-style click-drag); userData values are free-form strings
// edited in place (the editor treats them as opaque — semantics belong to the
// game). All edits go through the undo stack.

import { getScreenWidth, getScreenHeight, drawText } from 'bloom';
import { UiContext } from '../ui-context';
import {
  beginPanel, endPanel, label, labelSmall, separator, vec3Field, dragFloat,
  toolButton, button, Ref,
} from '../widgets';
import { textInput } from '../text-input';
import { Theme } from '../theme';
import { EditorState, selectedEntityId } from '../../state/editor-state';
import { TransformEntityCommand } from '../../state/commands/transform-entity';
import { SetUserDataCommand } from '../../state/commands/set-userdata';
import {
  EditWaterCommand, EditRiverCommand, RemoveWaterCommand, RemoveRiverCommand,
} from '../../state/commands/edit-water';
import { runCommand } from '../../state/commands';
import { Vec3Lit, TransformData, EntityData, WaterVolume, RiverSpline } from 'bloom/world';

// Add-row scratch state — survives across frames until '+' commits it.
const newKeyRef: Ref<string> = { value: '' };
const newValRef: Ref<string> = { value: '' };

export function drawInspector(ui: UiContext, state: EditorState): void {
  const screenW = getScreenWidth();
  const screenH = getScreenHeight();
  const pw = Theme.assetPanelWidth;
  const px = screenW - pw;

  // Water and rivers get their own property panels — they are not entities and
  // have no transform, model, tags, or userData.
  if (state.selection.kind === 'water' && state.selection.primary !== null) {
    drawWaterInspector(ui, state, px, screenH, pw);
    return;
  }
  if (state.selection.kind === 'river' && state.selection.primary !== null) {
    drawRiverInspector(ui, state, px, screenH, pw);
    return;
  }

  const entity = selectedEntityId(state) !== null
    ? state.world.entities.find(e => e.id === selectedEntityId(state))
    : undefined;

  // Panel grows upward with the userData row count (no scrolling yet).
  const rowAdvance = Theme.rowHeight + Theme.spacing;
  const udRows = entity ? Object.keys(entity.userData).length : 0;
  let panelH = 300 + udRows * rowAdvance;
  const maxH = Math.floor(screenH * 0.65);
  if (panelH > maxH) panelH = maxH;
  const py = screenH - Theme.statusBarHeight - panelH;

  beginPanel(ui, 'inspector', px, py, pw, panelH, 'Inspector');

  if (!entity) {
    labelSmall(ui, state.selection.primary === null ? 'No selection' : 'Entity not found');
    endPanel(ui);
    return;
  }

  // Name.
  label(ui, entity.name);
  labelSmall(ui, entity.id + (entity.modelRef ? '  (' + entity.modelRef + ')' : ''));
  separator(ui);

  // Transform fields.
  const beforeTransform = cloneTransform(entity.transform);

  const posRef: Ref<Vec3Lit> = { value: entity.transform.position };
  const rotRef: Ref<Vec3Lit> = { value: entity.transform.rotation };
  const sclRef: Ref<Vec3Lit> = { value: entity.transform.scale };

  let changed = false;
  changed = vec3Field(ui, 'insp_pos', 'Position', posRef) || changed;
  changed = vec3Field(ui, 'insp_rot', 'Rotation', rotRef) || changed;
  changed = vec3Field(ui, 'insp_scl', 'Scale', sclRef) || changed;

  if (changed) {
    entity.transform.position = posRef.value;
    entity.transform.rotation = rotRef.value;
    entity.transform.scale = sclRef.value;
    state.pendingRebuild.add(entity.id);

    runCommand(state, new TransformEntityCommand(
      entity.id, beforeTransform, entity.transform,
    ));
  }

  // Tags.
  if (entity.tags.length > 0) {
    separator(ui);
    labelSmall(ui, 'Tags: ' + entity.tags.join(', '));
  }

  separator(ui);
  drawUserDataSection(ui, state, entity);

  endPanel(ui);
}

// ---- userData table ----------------------------------------------------------

function drawUserDataSection(ui: UiContext, state: EditorState, entity: EntityData): void {
  labelSmall(ui, 'userData');

  const keyColW = 86;
  const delW = 18;
  const innerW = ui.panelW - Theme.padding * 2;
  const fieldX = ui.cursorX + keyColW;
  const fieldW = innerW - keyColW - delW - 6;

  const keys = Object.keys(entity.userData);
  for (let k = 0; k < keys.length; k++) {
    const key = keys[k];
    const rowY = ui.cursorY;
    const oldValue = entity.userData[key];

    drawText(key, ui.cursorX, rowY + 4, Theme.fontSizeSmall, Theme.textDim);

    const valRef: Ref<string> = { value: oldValue };
    if (textInput(ui, 'ud_' + entity.id + '_' + key, valRef, fieldX, rowY, fieldW)) {
      runCommand(state, new SetUserDataCommand(entity.id, key, oldValue, valRef.value));
    }

    if (toolButton(ui, 'ud_del_' + entity.id + '_' + key, 'x', fieldX + fieldW + 4, rowY, delW, false)) {
      runCommand(state, new SetUserDataCommand(entity.id, key, oldValue, null));
    }

    ui.cursorY = rowY + Theme.rowHeight + Theme.spacing;
  }

  // Add-row: key field, value field, '+' commits (key must be new and non-empty).
  const addY = ui.cursorY;
  const halfW = Math.floor((innerW - delW - 8) / 2);
  textInput(ui, 'ud_newkey_' + entity.id, newKeyRef, ui.cursorX, addY, halfW);
  textInput(ui, 'ud_newval_' + entity.id, newValRef, ui.cursorX + halfW + 4, addY, halfW);
  if (toolButton(ui, 'ud_add_' + entity.id, '+', ui.cursorX + halfW * 2 + 8, addY, delW, false)) {
    const nk = newKeyRef.value.trim();
    if (nk.length > 0 && entity.userData[nk] === undefined) {
      runCommand(state, new SetUserDataCommand(entity.id, nk, null, newValRef.value));
      newKeyRef.value = '';
      newValRef.value = '';
    }
  }
  ui.cursorY = addY + Theme.rowHeight + Theme.spacing;
}

function cloneTransform(t: TransformData): TransformData {
  return {
    position: [t.position[0], t.position[1], t.position[2]],
    rotation: [t.rotation[0], t.rotation[1], t.rotation[2]],
    scale: [t.scale[0], t.scale[1], t.scale[2]],
  };
}

// ---- water inspector ---------------------------------------------------------

function cloneWater(w: WaterVolume): WaterVolume {
  return {
    id: w.id, kind: w.kind,
    center: [w.center[0], w.center[1], w.center[2]],
    size: [w.size[0], w.size[1], w.size[2]],
    surfaceHeight: w.surfaceHeight,
    color: [w.color[0], w.color[1], w.color[2], w.color[3]],
    waveAmplitude: w.waveAmplitude,
    waveSpeed: w.waveSpeed,
  };
}

function drawWaterInspector(
  ui: UiContext, state: EditorState,
  px: number, screenH: number, pw: number,
): void {
  const panelH = 330;
  const py = screenH - Theme.statusBarHeight - panelH;
  beginPanel(ui, 'inspector', px, py, pw, panelH, 'Water');

  const idx = state.world.water.findIndex(w => w.id === state.selection.primary);
  if (idx < 0) {
    labelSmall(ui, 'Water volume not found');
    endPanel(ui);
    return;
  }

  const w = state.world.water[idx];
  const before = cloneWater(w);
  let changed = false;

  label(ui, w.id);
  separator(ui);

  const centerRef: Ref<Vec3Lit> = { value: [w.center[0], w.center[1], w.center[2]] };
  if (vec3Field(ui, 'wat_center', 'Center', centerRef)) {
    w.center = centerRef.value;
    changed = true;
  }

  const sizeRef: Ref<Vec3Lit> = { value: [w.size[0], w.size[1], w.size[2]] };
  if (vec3Field(ui, 'wat_size', 'Size', sizeRef)) {
    w.size = sizeRef.value;
    changed = true;
  }

  const surfRef: Ref<number> = { value: w.surfaceHeight };
  if (dragFloat(ui, 'wat_surf', 'Surface Y', surfRef, 0.05, -100, 100)) {
    w.surfaceHeight = surfRef.value;
    changed = true;
  }

  const ampRef: Ref<number> = { value: w.waveAmplitude };
  if (dragFloat(ui, 'wat_amp', 'Wave Amp', ampRef, 0.01, 0, 2)) {
    w.waveAmplitude = ampRef.value;
    changed = true;
  }

  const spdRef: Ref<number> = { value: w.waveSpeed };
  if (dragFloat(ui, 'wat_spd', 'Wave Spd', spdRef, 0.01, 0, 10)) {
    w.waveSpeed = spdRef.value;
    changed = true;
  }

  separator(ui);
  changed = drawColorFields(ui, 'wat', w.color) || changed;

  if (changed) {
    runCommand(state, new EditWaterCommand(w.id, before, w));
  }

  separator(ui);
  if (button(ui, 'wat_delete', 'Delete volume')) {
    runCommand(state, new RemoveWaterCommand(state.world.water[idx], idx));
  }

  endPanel(ui);
}

// ---- river inspector ---------------------------------------------------------

function cloneRiver(r: RiverSpline): RiverSpline {
  const pts: [number, number, number][] = [];
  for (let i = 0; i < r.controlPoints.length; i++) {
    const p = r.controlPoints[i];
    pts.push([p[0], p[1], p[2]]);
  }
  return {
    id: r.id,
    controlPoints: pts,
    widths: r.widths.slice(),
    depth: r.depth,
    flowSpeed: r.flowSpeed,
    color: [r.color[0], r.color[1], r.color[2], r.color[3]],
  };
}

function drawRiverInspector(
  ui: UiContext, state: EditorState,
  px: number, screenH: number, pw: number,
): void {
  const panelH = 300;
  const py = screenH - Theme.statusBarHeight - panelH;
  beginPanel(ui, 'inspector', px, py, pw, panelH, 'River');

  const idx = state.world.rivers.findIndex(r => r.id === state.selection.primary);
  if (idx < 0) {
    labelSmall(ui, 'River not found');
    endPanel(ui);
    return;
  }

  const r = state.world.rivers[idx];
  const before = cloneRiver(r);
  let changed = false;

  label(ui, r.id);
  labelSmall(ui, r.controlPoints.length + ' control points');
  separator(ui);

  const depthRef: Ref<number> = { value: r.depth };
  if (dragFloat(ui, 'riv_depth', 'Depth', depthRef, 0.05, 0, 20)) {
    r.depth = depthRef.value;
    changed = true;
  }

  const flowRef: Ref<number> = { value: r.flowSpeed };
  if (dragFloat(ui, 'riv_flow', 'Flow Spd', flowRef, 0.01, 0, 10)) {
    r.flowSpeed = flowRef.value;
    changed = true;
  }

  // One width for the whole river: per-point widths are in the format, but a
  // single slider covers the common case without a per-point UI. Editing it
  // sets every point's width; the file keeps the array.
  const widthRef: Ref<number> = { value: r.widths.length > 0 ? r.widths[0] : 1 };
  if (dragFloat(ui, 'riv_width', 'Width', widthRef, 0.05, 0.1, 50)) {
    for (let i = 0; i < r.widths.length; i++) r.widths[i] = widthRef.value;
    changed = true;
  }

  separator(ui);
  changed = drawColorFields(ui, 'riv', r.color) || changed;

  if (changed) {
    runCommand(state, new EditRiverCommand(r.id, before, r));
  }

  separator(ui);
  if (button(ui, 'riv_delete', 'Delete river')) {
    runCommand(state, new RemoveRiverCommand(state.world.rivers[idx], idx));
  }

  endPanel(ui);
}

// RGBA in 0-1, edited in place. Shared by both panels.
function drawColorFields(ui: UiContext, idPrefix: string, color: number[]): boolean {
  let changed = false;

  const rgbRef: Ref<Vec3Lit> = { value: [color[0], color[1], color[2]] };
  if (vec3Field(ui, idPrefix + '_rgb', 'Color RGB', rgbRef)) {
    color[0] = clamp01(rgbRef.value[0]);
    color[1] = clamp01(rgbRef.value[1]);
    color[2] = clamp01(rgbRef.value[2]);
    changed = true;
  }

  const alphaRef: Ref<number> = { value: color[3] };
  if (dragFloat(ui, idPrefix + '_a', 'Opacity', alphaRef, 0.01, 0, 1)) {
    color[3] = clamp01(alphaRef.value);
    changed = true;
  }

  return changed;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : (v > 1 ? 1 : v);
}
