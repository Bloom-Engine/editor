// Right-bottom property inspector: shows transform, name, tags, and the
// userData key/value table for the selected entity. Transform fields use
// dragFloat (Blender-style click-drag); userData values are free-form strings
// edited in place (the editor treats them as opaque — semantics belong to the
// game). All edits go through the undo stack.

import { getScreenWidth, getScreenHeight, drawText } from 'bloom';
import { UiContext } from '../ui-context';
import { beginPanel, endPanel, label, labelSmall, separator, vec3Field, toolButton, Ref } from '../widgets';
import { textInput } from '../text-input';
import { Theme } from '../theme';
import { EditorState } from '../../state/editor-state';
import { TransformEntityCommand } from '../../state/commands/transform-entity';
import { SetUserDataCommand } from '../../state/commands/set-userdata';
import { runCommand } from '../../state/commands';
import { Vec3Lit, TransformData, EntityData } from 'bloom/world';

// Add-row scratch state — survives across frames until '+' commits it.
const newKeyRef: Ref<string> = { value: '' };
const newValRef: Ref<string> = { value: '' };

export function drawInspector(ui: UiContext, state: EditorState): void {
  const screenW = getScreenWidth();
  const screenH = getScreenHeight();
  const pw = Theme.assetPanelWidth;
  const px = screenW - pw;

  const entity = state.selection.primary !== null
    ? state.world.entities.find(e => e.id === state.selection.primary)
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
