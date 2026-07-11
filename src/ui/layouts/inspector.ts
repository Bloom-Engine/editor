// Right-bottom property inspector: shows transform, name, and tags for the
// selected entity. Transform fields use dragFloat (Blender-style click-drag).

import { getScreenWidth, getScreenHeight } from 'bloom';
import { UiContext } from '../ui-context';
import { beginPanel, endPanel, label, labelSmall, separator, dragFloat, vec3Field, Ref } from '../widgets';
import { Theme } from '../theme';
import { EditorState } from '../../state/editor-state';
import { TransformEntityCommand } from '../../state/commands/transform-entity';
import { runCommand } from '../../state/commands';
import { Vec3Lit, TransformData } from 'bloom/world';

export function drawInspector(ui: UiContext, state: EditorState): void {
  const screenW = getScreenWidth();
  const screenH = getScreenHeight();
  const pw = Theme.assetPanelWidth;
  const px = screenW - pw;
  // Inspector fills the bottom half of the asset panel column.
  const panelH = 260;
  const py = screenH - Theme.statusBarHeight - panelH;

  beginPanel(ui, 'inspector', px, py, pw, panelH, 'Inspector');

  if (state.selection.primary === null) {
    labelSmall(ui, 'No selection');
    endPanel(ui);
    return;
  }

  const entity = state.world.entities.find(e => e.id === state.selection.primary);
  if (!entity) {
    labelSmall(ui, 'Entity not found');
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

  endPanel(ui);
}

function cloneTransform(t: TransformData): TransformData {
  return {
    position: [t.position[0], t.position[1], t.position[2]],
    rotation: [t.rotation[0], t.rotation[1], t.rotation[2]],
    scale: [t.scale[0], t.scale[1], t.scale[2]],
  };
}
