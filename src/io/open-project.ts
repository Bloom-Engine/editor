// Switch the editor to another project mid-session (PLAN §H). Loads the
// project file, relists the asset catalog (models stream in via
// pumpAssetCatalog), opens its default world, and records it in the
// recent-projects list.

import { setWindowTitle } from 'bloom';
import { EditorState, setStatus } from '../state/editor-state';
import { loadProject } from './project';
import { loadAssetCatalog } from './asset-catalog';
import { openWorld, newWorld } from './world-io';
import { joinPath } from './paths';
import { addRecentProject } from './recent';
import { frameCameraOnWorld } from '../viewport/frame';

export function openProject(state: EditorState, projectPath: string): boolean {
  if (!loadProject(state, projectPath)) {
    setStatus(state, 'Could not open project: ' + projectPath);
    return false;
  }

  loadAssetCatalog(state);

  const project = state.project;
  if (project === null) return false;

  if (project.defaultWorld.length > 0) {
    const worldPath = joinPath(project.worldsDir, project.defaultWorld);
    if (openWorld(state, worldPath)) {
      frameCameraOnWorld(state);
    } else {
      newWorld(state);
    }
  } else {
    newWorld(state);
  }

  addRecentProject(project.name, project.filePath);
  setWindowTitle('Bloom World Editor — ' + project.name +
    (project.gameId.length > 0 ? ' (' + project.gameId + ')' : ''));
  setStatus(state, 'Opened project ' + project.name);
  return true;
}
