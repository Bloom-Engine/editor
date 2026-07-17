// Environment inspector panel — edit sky, sun, ambient, fog, shadows.
// Every field covers the full EnvironmentData schema (sunColor, ambientColor,
// and fogColor included), and every edit goes through SetEnvironmentCommand
// so Ctrl+Z works. Per-field merge keys mean one undo entry per slider drag.

import { UiContext } from '../ui-context';
import { beginPanel, endPanel, separator, dragFloat, vec3Field, toggleButton, Ref } from '../widgets';
import { Theme } from '../theme';
import { EditorState } from '../../state/editor-state';
import { runCommand } from '../../state/commands';
import { SetEnvironmentCommand, cloneEnvironment } from '../../state/commands/set-environment';
import { Vec3Lit } from 'bloom/world';

export function drawEnvironmentPanel(ui: UiContext, state: EditorState): void {
  const px = Theme.outlinerWidth + 10;
  const py = Theme.toolbarHeight + 10;
  const pw = 260;
  const ph = 560;

  beginPanel(ui, 'env_panel', px, py, pw, ph, 'Environment');

  const env = state.world.environment;
  // Snapshot for the command's `before`; taken once per frame, so a drag
  // commits (previous frame's value -> this frame's value) each tick and the
  // merge collapses the whole drag into one undo entry.
  const before = cloneEnvironment(env);

  const commit = (fieldKey: string): void => {
    runCommand(state, new SetEnvironmentCommand(fieldKey, before, env));
  };

  // Sky color.
  const skyRef: Ref<Vec3Lit> = { value: env.skyColor };
  if (vec3Field(ui, 'env_sky', 'Sky Color', skyRef)) {
    env.skyColor = skyRef.value;
    commit('skyColor');
  }

  separator(ui);

  // Sun.
  const sunDirRef: Ref<Vec3Lit> = { value: env.sunDirection };
  if (vec3Field(ui, 'env_sundir', 'Sun Dir', sunDirRef)) {
    env.sunDirection = sunDirRef.value;
    commit('sunDirection');
  }

  const sunColRef: Ref<Vec3Lit> = { value: env.sunColor };
  if (vec3Field(ui, 'env_suncol', 'Sun Color', sunColRef)) {
    env.sunColor = clampColor(sunColRef.value);
    commit('sunColor');
  }

  const sunIntRef: Ref<number> = { value: env.sunIntensity };
  if (dragFloat(ui, 'env_sunint', 'Sun Int', sunIntRef, 0.01, 0, 5)) {
    env.sunIntensity = sunIntRef.value;
    commit('sunIntensity');
  }

  separator(ui);

  // Ambient.
  const ambColRef: Ref<Vec3Lit> = { value: env.ambientColor };
  if (vec3Field(ui, 'env_ambcol', 'Ambient Color', ambColRef)) {
    env.ambientColor = clampColor(ambColRef.value);
    commit('ambientColor');
  }

  const ambIntRef: Ref<number> = { value: env.ambientIntensity };
  if (dragFloat(ui, 'env_ambint', 'Ambient Int', ambIntRef, 0.01, 0, 2)) {
    env.ambientIntensity = ambIntRef.value;
    commit('ambientIntensity');
  }

  separator(ui);

  // Fog.
  const fogColRef: Ref<Vec3Lit> = { value: env.fogColor };
  if (vec3Field(ui, 'env_fogcol', 'Fog Color', fogColRef)) {
    env.fogColor = clampColor(fogColRef.value);
    commit('fogColor');
  }

  const fogStartRef: Ref<number> = { value: env.fogStart };
  if (dragFloat(ui, 'env_fogs', 'Fog Start', fogStartRef, 0.5, 0, 500)) {
    env.fogStart = fogStartRef.value;
    commit('fogStart');
  }
  const fogEndRef: Ref<number> = { value: env.fogEnd };
  if (dragFloat(ui, 'env_foge', 'Fog End', fogEndRef, 0.5, 0, 500)) {
    env.fogEnd = fogEndRef.value;
    commit('fogEnd');
  }

  separator(ui);

  // Shadows.
  if (toggleButton(ui, 'env_shadows', 'Shadows', env.shadowsEnabled)) {
    env.shadowsEnabled = !env.shadowsEnabled;
    commit('shadowsEnabled');
  }

  endPanel(ui);
}

function clampColor(c: Vec3Lit): Vec3Lit {
  return [clamp01(c[0]), clamp01(c[1]), clamp01(c[2])];
}

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
