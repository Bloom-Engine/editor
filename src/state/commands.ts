// Command execution, undo/redo stack.
//
// Every user action that mutates the world goes through `runCommand`. The
// command's `do` method applies the change; the stack keeps a clone for `undo`.
// `mergeWith` lets continuous drags (e.g. gizmo movement) coalesce into a
// single undo step so Ctrl+Z doesn't replay 200 mouse-move ticks.

import { EditorState, Command } from './editor-state';

export function runCommand(state: EditorState, cmd: Command): void {
  cmd.do(state);
  state.modified = true;

  // Try to merge with the top of the undo stack (e.g. dragging a gizmo).
  const top = state.undoStack.length > 0
    ? state.undoStack[state.undoStack.length - 1]
    : null;
  if (top !== null && top.mergeWith && top.mergeWith(cmd)) {
    // Merged into the existing top entry — the old `do` state is updated in
    // place by `mergeWith`. Nothing to push.
  } else {
    state.undoStack.push(cmd);
    if (state.undoStack.length > state.maxHistory) {
      state.undoStack.shift();
    }
  }

  // Any new action invalidates the redo branch.
  state.redoStack.length = 0;
}

export function undo(state: EditorState): void {
  if (state.undoStack.length === 0) return;
  const cmd = state.undoStack.pop() as Command;
  cmd.undo(state);
  state.redoStack.push(cmd);
  state.modified = true;
}

export function redo(state: EditorState): void {
  if (state.redoStack.length === 0) return;
  const cmd = state.redoStack.pop() as Command;
  cmd.do(state);
  state.undoStack.push(cmd);
  state.modified = true;
}
