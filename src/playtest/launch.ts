// Play-in-editor: run the real game on the level you are looking at.
//
// The fly-cam (playtest.ts) shows you the geometry. It cannot show you whether the
// spawners spawn, whether the cover works, whether the arena has a shape — the
// things a level actually has to do. For that you need the game, and if testing a
// level means "add it to a manifest, restart the game, navigate the menu", it will
// not get tested often enough to matter.
//
// So: save the current world to a scratch file, launch the game pointed straight at
// it (`--world <path>`), and get out of the way.

import { launchProcess } from 'bloom/core';
import { saveWorld } from 'bloom/world';
import { EditorState, setStatus } from '../state/editor-state';
import { joinPath, projectRelative } from '../io/paths';

/// The scratch level. Deliberately inside the project's worlds dir rather than a
/// system temp dir: the game resolves asset paths relative to its own working
/// directory, so a world parked in %TEMP% would load and then fail to find a single
/// model. Gitignored.
const SCRATCH = '__playtest.world.json';

export function launchGame(state: EditorState): void {
  const project = state.project;
  if (!project) {
    setStatus(state, 'No project — cannot launch');
    return;
  }
  if (project.playCommand.length === 0) {
    setStatus(state, 'No "playCommand" in editor.project.json');
    return;
  }

  // Save what is on screen, NOT what is on disk. The whole point is to test the
  // edit you just made, and making you save first would defeat it.
  const worldPath = joinPath(project.worldsDir, SCRATCH);
  const res = saveWorld(worldPath, state.world);
  if (!res.ok) {
    setStatus(state, 'Play: could not write ' + worldPath);
    return;
  }
  // Fire and forget. The editor must not block on the game, and must not die with
  // it either: close the game and you are back in the editor, undo history intact.
  //
  // launchProcess, not child_process.spawn — Perry's spawn compiles and then does
  // nothing at all (undefined pid, no process). See engine EN-048.
  // The game runs with cwd = project root, so the --world argument must be
  // PROJECT-relative — worldPath here is editor-relative and only matches
  // when the editor happens to run from the project root.
  const cwd = project.rootDir.length > 0 ? project.rootDir : '.';
  const gameWorldArg = projectRelative(project.rootDir, worldPath);
  const pid = launchProcess(project.playCommand, ['--world', gameWorldArg], cwd);
  if (pid === 0) {
    setStatus(state, 'Play: could not launch ' + project.playCommand);
    return;
  }
  setStatus(state, 'Playing this level in ' + project.playCommand + ' (pid ' + pid + ')');
}
