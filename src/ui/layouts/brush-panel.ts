// Brush settings panel — visible when the brush tool is active.
// Controls: brush kind radio, radius slider, strength slider, flatten target.

import { UiContext } from '../ui-context';
import { beginPanel, endPanel, labelSmall, separator, dragFloat, toggleButton, button, Ref } from '../widgets';
import { Theme } from '../theme';
import { EditorState, BrushSettings } from '../../state/editor-state';
import { runCommand } from '../../state/commands';
import { CreateTerrainCommand } from '../../state/commands/create-terrain';

export function drawBrushPanel(ui: UiContext, state: EditorState): void {
  if (state.activeTool !== 'brush') return;

  const px = Theme.outlinerWidth + 10;
  const py = Theme.toolbarHeight + 10;
  const pw = 220;
  const ph = 240;

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

  beginPanel(ui, 'brush_panel', px, py, pw, ph, 'Brush Settings');

  const brush = state.brush;

  // Kind toggles.
  const kinds: BrushSettings['kind'][] = ['raise', 'lower', 'smooth', 'flatten'];
  for (let i = 0; i < kinds.length; i++) {
    if (toggleButton(ui, 'brush_kind_' + kinds[i], kinds[i], brush.kind === kinds[i])) {
      brush.kind = kinds[i];
    }
  }

  separator(ui);

  // Radius.
  const radiusRef: Ref<number> = { value: brush.radius };
  if (dragFloat(ui, 'brush_radius', 'Radius', radiusRef, 0.1, 1, 30)) {
    brush.radius = radiusRef.value;
  }

  // Strength.
  const strengthRef: Ref<number> = { value: brush.strength };
  if (dragFloat(ui, 'brush_strength', 'Strength', strengthRef, 0.01, 0.01, 2.0)) {
    brush.strength = strengthRef.value;
  }

  // Flatten target height (only when kind === 'flatten').
  if (brush.kind === 'flatten') {
    const targetRef: Ref<number> = { value: brush.targetHeight };
    if (dragFloat(ui, 'brush_target', 'Target H', targetRef, 0.1, -50, 50)) {
      brush.targetHeight = targetRef.value;
    }
  }

  endPanel(ui);
}
