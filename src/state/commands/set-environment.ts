// Command: edit the world's environment block (PLAN §I). Before this existed,
// the environment panel mutated state.world.environment directly — the only
// mutation path in the editor that bypassed undo.
//
// `fieldKey` scopes merging: consecutive edits to the SAME field (one slider
// drag) coalesce into one undo entry, while moving to a different field starts
// a new entry — so Ctrl+Z steps back field by field, not "the whole session".

import { EnvironmentData } from 'bloom/world';
import { EditorState, Command } from '../editor-state';

export function cloneEnvironment(e: EnvironmentData): EnvironmentData {
  return {
    skyColor: [e.skyColor[0], e.skyColor[1], e.skyColor[2]],
    ambientColor: [e.ambientColor[0], e.ambientColor[1], e.ambientColor[2]],
    ambientIntensity: e.ambientIntensity,
    sunDirection: [e.sunDirection[0], e.sunDirection[1], e.sunDirection[2]],
    sunColor: [e.sunColor[0], e.sunColor[1], e.sunColor[2]],
    sunIntensity: e.sunIntensity,
    fogStart: e.fogStart,
    fogEnd: e.fogEnd,
    fogColor: [e.fogColor[0], e.fogColor[1], e.fogColor[2]],
    shadowsEnabled: e.shadowsEnabled,
  };
}

export class SetEnvironmentCommand implements Command {
  readonly label: string;
  readonly fieldKey: string;
  private before: EnvironmentData;
  private after: EnvironmentData;

  constructor(fieldKey: string, before: EnvironmentData, after: EnvironmentData) {
    this.fieldKey = fieldKey;
    this.before = cloneEnvironment(before);
    this.after = cloneEnvironment(after);
    this.label = 'Environment ' + fieldKey;
  }

  do(state: EditorState): void {
    state.world.environment = cloneEnvironment(this.after);
    state.pendingEnvironmentSync = true;
  }

  undo(state: EditorState): void {
    state.world.environment = cloneEnvironment(this.before);
    state.pendingEnvironmentSync = true;
  }

  mergeWith(next: Command): boolean {
    if (!(next instanceof SetEnvironmentCommand)) return false;
    if ((next as SetEnvironmentCommand).fieldKey !== this.fieldKey) return false;
    this.after = cloneEnvironment((next as SetEnvironmentCommand).after);
    return true;
  }
}
