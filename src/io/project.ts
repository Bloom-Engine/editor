// Load editor.project.json from disk and resolve paths.

import { readFile, fileExists } from 'bloom';
import { EditorState, Project } from '../state/editor-state';
import { joinPath } from './paths';

export function loadProject(state: EditorState): boolean {
  // Walk up from CWD looking for editor.project.json.
  const candidates = [
    'editor.project.json',
    '../editor.project.json',
    '../../editor.project.json',
  ];

  let foundPath: string | null = null;
  for (let i = 0; i < candidates.length; i++) {
    if (fileExists(candidates[i])) {
      foundPath = candidates[i];
      break;
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
    defaultWorld?: string;
  };

  // Determine the root directory from the project file path.
  const lastSlash = foundPath.lastIndexOf('/');
  const rootDir = lastSlash > 0 ? foundPath.substring(0, lastSlash) : '.';

  state.project = {
    filePath: foundPath,
    rootDir: rootDir,
    name: raw.name || 'Untitled Project',
    modelsDir: joinPath(rootDir, raw.modelsDir || 'assets/models'),
    prefabsDir: joinPath(rootDir, raw.prefabsDir || 'assets/prefabs'),
    worldsDir: joinPath(rootDir, raw.worldsDir || 'assets/worlds'),
    defaultWorld: raw.defaultWorld || '',
  };

  return true;
}
