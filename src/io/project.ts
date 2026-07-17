// Load editor.project.json from disk and resolve paths.

import { readFile, fileExists } from 'bloom';
import { EditorState, Project } from '../state/editor-state';
import { joinPath } from './paths';

// `explicitPath` (from `--project <path>`) skips the CWD walk entirely — the
// editor can open any game's project from anywhere.
export function loadProject(state: EditorState, explicitPath?: string | null): boolean {
  let foundPath: string | null = null;

  if (explicitPath !== undefined && explicitPath !== null && explicitPath.length > 0) {
    if (!fileExists(explicitPath)) {
      console.error('loadProject: --project file not found: ' + explicitPath);
      return false;
    }
    foundPath = explicitPath;
  } else {
    // Walk up from CWD looking for editor.project.json.
    const candidates = [
      'editor.project.json',
      '../editor.project.json',
      '../../editor.project.json',
    ];
    for (let i = 0; i < candidates.length; i++) {
      if (fileExists(candidates[i])) {
        foundPath = candidates[i];
        break;
      }
    }
  }

  if (foundPath === null) {
    // No project file — editor starts with an empty project.
    return false;
  }

  const text = readFile(foundPath);
  if (!text || text.length === 0) return false;

  const raw = JSON.parse(text) as {
    name?: string;
    gameId?: string;
    modelsDir?: string;
    prefabsDir?: string;
    worldsDir?: string;
    texturesDir?: string;
    defaultWorld?: string;
    playCommand?: string;
    kindColors?: Record<string, string>;
  };

  // Determine the root directory from the project file path. `--project` may
  // arrive with Windows backslashes; normalize so rootDir/joinPath stay sane.
  const normPath = foundPath.split('\\').join('/');
  const lastSlash = normPath.lastIndexOf('/');
  const rootDir = lastSlash > 0 ? normPath.substring(0, lastSlash) : '.';

  // Optional `kindColors`: { "<userData.kind>": "r,g,b" } with 0-255 channels.
  // Lets any game color its own marker-entity placeholders without the editor
  // hardcoding that game's vocabulary. Parallel arrays — see the Project type.
  const kindColorKeys: string[] = [];
  const kindColorValues: [number, number, number][] = [];
  if (raw.kindColors) {
    const kcKeys = Object.keys(raw.kindColors);
    for (let i = 0; i < kcKeys.length; i++) {
      const parsed = parseRgb255(raw.kindColors[kcKeys[i]]);
      if (parsed !== null) {
        kindColorKeys.push(kcKeys[i]);
        kindColorValues.push(parsed);
      } else {
        console.error('editor.project.json: kindColors["' + kcKeys[i] + '"] is not "r,g,b" (0-255) — ignored');
      }
    }
  }

  state.project = {
    filePath: normPath,
    rootDir: rootDir,
    name: raw.name || 'Untitled Project',
    gameId: raw.gameId || '',
    modelsDir: joinPath(rootDir, raw.modelsDir || 'assets/models'),
    prefabsDir: joinPath(rootDir, raw.prefabsDir || 'assets/prefabs'),
    worldsDir: joinPath(rootDir, raw.worldsDir || 'assets/worlds'),
    texturesDir: joinPath(rootDir, raw.texturesDir || 'assets/textures'),
    defaultWorld: raw.defaultWorld || '',
    playCommand: raw.playCommand || '',
    kindColorKeys: kindColorKeys,
    kindColorValues: kindColorValues,
  };

  return true;
}

function parseRgb255(s: string): [number, number, number] | null {
  if (!s || s.length === 0) return null;
  const parts = s.split(',');
  if (parts.length !== 3) return null;
  const r = parseFloat(parts[0]);
  const g = parseFloat(parts[1]);
  const b = parseFloat(parts[2]);
  if (r !== r || g !== g || b !== b) return null;
  return [r, g, b];
}
