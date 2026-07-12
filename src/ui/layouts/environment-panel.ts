// Environment inspector panel — edit sky, lighting, fog, shadows.
// Changes apply live via the pendingEnvironmentSync flag.

import { UiContext } from '../ui-context';
import { beginPanel, endPanel, separator, dragFloat, vec3Field, toggleButton, Ref } from '../widgets';
import { Theme } from '../theme';
import { EditorState } from '../../state/editor-state';
import { Vec3Lit } from 'bloom/world';

export function drawEnvironmentPanel(ui: UiContext, state: EditorState): void {
  // Only visible when no entity is selected (or via a toggle).
  // For now, always draw in a floating panel position.
  const px = Theme.outlinerWidth + 10;
  const py = Theme.toolbarHeight + 10;
  const pw = 260;
  const ph = 360;

  beginPanel(ui, 'env_panel', px, py, pw, ph, 'Environment');

  const env = state.world.environment;
  let dirty = false;

  // Sky color.
  const skyRef: Ref<Vec3Lit> = { value: env.skyColor };
  if (vec3Field(ui, 'env_sky', 'Sky Color', skyRef)) {
    env.skyColor = skyRef.value;
    dirty = true;
  }

  separator(ui);

  // Sun direction.
  const sunDirRef: Ref<Vec3Lit> = { value: env.sunDirection };
  if (vec3Field(ui, 'env_sundir', 'Sun Dir', sunDirRef)) {
    env.sunDirection = sunDirRef.value;
    dirty = true;
  }

  // Sun intensity.
  const sunIntRef: Ref<number> = { value: env.sunIntensity };
  if (dragFloat(ui, 'env_sunint', 'Sun Int', sunIntRef, 0.01, 0, 5)) {
    env.sunIntensity = sunIntRef.value;
    dirty = true;
  }

  separator(ui);

  // Ambient intensity.
  const ambIntRef: Ref<number> = { value: env.ambientIntensity };
  if (dragFloat(ui, 'env_ambint', 'Ambient', ambIntRef, 0.01, 0, 2)) {
    env.ambientIntensity = ambIntRef.value;
    dirty = true;
  }

  separator(ui);

  // Fog.
  const fogStartRef: Ref<number> = { value: env.fogStart };
  if (dragFloat(ui, 'env_fogs', 'Fog Start', fogStartRef, 0.5, 0, 500)) {
    env.fogStart = fogStartRef.value;
    dirty = true;
  }
  const fogEndRef: Ref<number> = { value: env.fogEnd };
  if (dragFloat(ui, 'env_foge', 'Fog End', fogEndRef, 0.5, 0, 500)) {
    env.fogEnd = fogEndRef.value;
    dirty = true;
  }

  separator(ui);

  // Shadows.
  if (toggleButton(ui, 'env_shadows', 'Shadows', env.shadowsEnabled)) {
    env.shadowsEnabled = !env.shadowsEnabled;
    dirty = true;
  }

  if (dirty) {
    state.pendingEnvironmentSync = true;
    state.modified = true;
  }

  endPanel(ui);
}
