// Brush settings panel — visible when the brush tool is active.
//
// Two brushes share it: the sculpt brush (raise/lower/smooth/flatten), which
// moves heights, and the paint brush, which writes splat weights. Paint needs a
// layer to paint INTO, so when it is selected the panel grows a layer list: the
// layers are the world's (`terrain.layers`), the swatch beside each is the mask
// colour the viewport tints it with, and `+ Add layer` picks a texture out of
// the project's textures dir.
//
// The swatch is a MASK colour, not a thumbnail of the texture — see
// `terrainLayerMaskColor` in the engine. The viewport shows you *coverage*; the
// game is what shows you the material.

import { drawRect, drawText } from 'bloom';
import { terrainLayerMaskColor } from 'bloom/world';
import { UiContext } from '../ui-context';
import { beginPanel, endPanel, label, labelSmall, separator, dragFloat, toggleButton, button, listRow, Ref } from '../widgets';
import { Theme, UiColor } from '../theme';
import { EditorState, BrushSettings } from '../../state/editor-state';
import { runCommand } from '../../state/commands';
import { CreateTerrainCommand } from '../../state/commands/create-terrain';
import { AddTerrainLayerCommand, RemoveTerrainLayerCommand } from '../../state/commands/terrain-paint';
import { basenameNoExt } from '../../io/paths';

// Is the "+ Add layer" texture picker open? Panel-local: it is not world data,
// it must not be undoable, and it must not survive a tool switch.
let pickingTexture = false;

function maskColor(i: number): UiColor {
  const c = terrainLayerMaskColor(i);
  return { r: c[0] * 255, g: c[1] * 255, b: c[2] * 255, a: 255 };
}

export function drawBrushPanel(ui: UiContext, state: EditorState): void {
  if (state.activeTool !== 'brush') {
    pickingTexture = false;
    return;
  }

  const px = Theme.outlinerWidth + 10;
  const py = Theme.toolbarHeight + 10;
  const pw = 240;

  // Terrain-less world: offer explicit creation instead of sculpting into a
  // silently materialized heightmap.
  if (!state.world.terrain) {
    beginPanel(ui, 'brush_panel', px, py, pw, 110, 'Brush Settings');
    labelSmall(ui, 'This world has no terrain.');
    labelSmall(ui, 'Create one to start sculpting:');
    if (button(ui, 'brush_create_terrain', 'Create terrain')) {
      runCommand(state, new CreateTerrainCommand());
    }
    endPanel(ui);
    return;
  }

  const terrain = state.world.terrain;
  const brush = state.brush;
  const painting = brush.kind === 'paint';

  // The panel grows with the layer list, and again with the picker. A fixed 240
  // was fine when it held four toggles and two sliders.
  let ph = 250;
  if (painting) {
    ph = ph + 60 + terrain.layers.length * Theme.rowHeight;
    if (pickingTexture) ph = ph + 40 + state.catalog.textureOrder.length * Theme.rowHeight;
  }

  beginPanel(ui, 'brush_panel', px, py, pw, ph, 'Brush Settings');

  const kinds: BrushSettings['kind'][] = ['raise', 'lower', 'smooth', 'flatten', 'paint'];
  for (let i = 0; i < kinds.length; i++) {
    if (toggleButton(ui, 'brush_kind_' + kinds[i], kinds[i], brush.kind === kinds[i])) {
      brush.kind = kinds[i];
      if (brush.kind !== 'paint') pickingTexture = false;
    }
  }

  separator(ui);

  const radiusRef: Ref<number> = { value: brush.radius };
  if (dragFloat(ui, 'brush_radius', 'Radius', radiusRef, 0.1, 1, 30)) {
    brush.radius = radiusRef.value;
  }

  const strengthRef: Ref<number> = { value: brush.strength };
  if (dragFloat(ui, 'brush_strength', 'Strength', strengthRef, 0.01, 0.01, 2.0)) {
    brush.strength = strengthRef.value;
  }

  if (brush.kind === 'flatten') {
    const targetRef: Ref<number> = { value: brush.targetHeight };
    if (dragFloat(ui, 'brush_target', 'Target H', targetRef, 0.1, -50, 50)) {
      brush.targetHeight = targetRef.value;
    }
  }

  if (painting) drawLayerList(ui, state);

  endPanel(ui);
}

function drawLayerList(ui: UiContext, state: EditorState): void {
  const terrain = state.world.terrain;
  if (!terrain) return;
  const brush = state.brush;

  separator(ui);
  label(ui, 'Splat layers');

  if (terrain.layers.length === 0) {
    labelSmall(ui, 'None yet — add one to paint.', Theme.textDim);
  }

  for (let i = 0; i < terrain.layers.length; i++) {
    const rowY = ui.cursorY;

    // Indent 1 leaves room for the swatch, which is overdrawn rather than laid
    // out beside the row: listRow owns the row's hit-test and cursor advance.
    if (listRow(ui, 'brush_layer_' + i, terrain.layers[i].id, i === brush.activeLayerIdx, 1)) {
      brush.activeLayerIdx = i;
    }

    const sw = 9;
    drawRect(ui.panelX + Theme.padding, rowY + (Theme.rowHeight - sw) / 2, sw, sw, maskColor(i));

    // Delete, right-aligned. Drawn after listRow so its hit-test wins the click.
    if (miniButton(ui, 'brush_layer_del_' + i, 'x', ui.panelX + ui.panelW - 22, rowY + 4)) {
      runCommand(state, new RemoveTerrainLayerCommand(i));
      return; // The list being iterated just changed length.
    }
  }

  if (!pickingTexture) {
    if (button(ui, 'brush_add_layer', '+ Add layer')) pickingTexture = true;
    if (terrain.layers.length > 0) {
      labelSmall(ui, 'LMB paint - Shift+LMB erase', Theme.textDim);
    }
    return;
  }

  // --- texture picker ---
  separator(ui);
  const textures = state.catalog.textureOrder;
  if (textures.length === 0) {
    labelSmall(ui, 'No textures in project.', Theme.textDim);
  }
  for (let i = 0; i < textures.length; i++) {
    const relPath = textures[i];
    if (listRow(ui, 'brush_tex_' + i, basenameNoExt(relPath), false, 1)) {
      // The layer id is the texture's basename: short, stable, and already what
      // the list shows — so a level author never has to name anything.
      runCommand(state, new AddTerrainLayerCommand(basenameNoExt(relPath), relPath, 1.0));
      pickingTexture = false;
      return;
    }
  }
  if (button(ui, 'brush_pick_cancel', 'Cancel')) pickingTexture = false;
}

/// A one-glyph square button at an explicit position, for the per-row delete.
/// `button` is full-width and cursor-driven, so it cannot sit inside a row.
function miniButton(ui: UiContext, id: string, text: string, x: number, y: number): boolean {
  const s = 16;
  const hovered = ui.mouseX >= x && ui.mouseX < x + s && ui.mouseY >= y && ui.mouseY < y + s;
  if (hovered) { ui.hotId = id; ui.mouseCaptured = true; }
  drawRect(x, y, s, s, hovered ? Theme.textError : Theme.button);
  drawText(text, x + 5, y + 2, Theme.fontSizeSmall, Theme.text);
  return hovered && ui.mousePressedLeft;
}
