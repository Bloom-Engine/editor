// Prefab authoring mode.
//
// THE IDEA THAT MAKES THIS SMALL. A `PrefabChild` is an `EntityData` minus `name`
// and `userData`. So while you are editing a prefab, its children simply ARE
// `state.world.entities`: the real world is parked in a stash and the prefab's
// children are handed to the editor as if they were the world.
//
// Everything then works for free — rendering, picking, the move/rotate/scale
// gizmos, delete, duplicate, snapping, undo/redo — because every one of those was
// already written against entities and none of them needs to know it is looking at
// a prefab. The alternative (a parallel render path, a parallel selection model,
// parallel gizmo handling for children) is how a feature stays unwritten forever.
// Which is exactly what happened here: the logic in this file has existed for weeks
// with ZERO call sites, because the UI it seemed to need was too big a job.
//
// Save converts the entities back into children and writes `*.prefab.json`.

import { isKeyPressed, Key, drawText } from 'bloom';
import {
  createEmptyPrefab, createEmptyWorld, savePrefab,
  PrefabData, PrefabChild, EntityData, WorldData,
} from 'bloom/world';
import { EditorState, PrefabStash } from '../state/editor-state';
import { rebuildAllSceneNodes } from '../world-sync/sync';
import { frameCameraOnBounds } from '../viewport/frame';
import { Theme } from '../ui/theme';

// --- conversions -------------------------------------------------------------

function childToEntity(c: PrefabChild): EntityData {
  const nm = c.modelRef !== null ? c.modelRef : (c.prefabRef !== null ? c.prefabRef : c.id);
  return {
    id: c.id,
    name: nm,
    modelRef: c.modelRef,
    prefabRef: c.prefabRef,
    transform: {
      position: [c.transform.position[0], c.transform.position[1], c.transform.position[2]],
      rotation: [c.transform.rotation[0], c.transform.rotation[1], c.transform.rotation[2]],
      scale: [c.transform.scale[0], c.transform.scale[1], c.transform.scale[2]],
    },
    tint: c.tint,
    tags: c.tags,
    userData: {},
  };
}

function entityToChild(e: EntityData): PrefabChild {
  return {
    id: e.id,
    modelRef: e.modelRef,
    prefabRef: e.prefabRef,
    transform: {
      position: [e.transform.position[0], e.transform.position[1], e.transform.position[2]],
      rotation: [e.transform.rotation[0], e.transform.rotation[1], e.transform.rotation[2]],
      scale: [e.transform.scale[0], e.transform.scale[1], e.transform.scale[2]],
    },
    tint: e.tint,
    tags: e.tags,
  };
}

/// A neutral stage to author on: no terrain, no water, no rivers — just the parts
/// and the grid. A prefab that was authored against one world's hills would look
/// wrong everywhere else.
function prefabWorkspace(prefab: PrefabData): WorldData {
  const w = createEmptyWorld('__prefab__', 'Prefab: ' + prefab.name);
  const n = prefab.children.length;
  const ents = new Array<EntityData>(n);
  for (let i = 0; i < n; i++) ents[i] = childToEntity(prefab.children[i]);
  w.entities = ents;
  return w;
}

// --- cycle rejection ---------------------------------------------------------

/// Would placing prefab `candidateId` inside the one we are editing create a cycle?
///
/// A prefab that contains itself — directly, or through a chain — expands forever at
/// load time and takes the game with it. The check has to be TRANSITIVE: A holding B
/// holding A is just as fatal as A holding A, and much easier to build by accident.
export function wouldCycle(state: EditorState, candidateId: string): boolean {
  const editing = state.editingPrefab;
  if (!editing) return false;
  if (candidateId === editing.id) return true;

  // Walk everything the candidate transitively contains, looking for ourselves.
  const seen = new Set<string>();
  const stack: string[] = [candidateId];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    const p = state.catalog.prefabs.get(id);
    if (!p) continue;
    for (let i = 0; i < p.children.length; i++) {
      const ref = p.children[i].prefabRef;
      if (ref === null) continue;
      if (ref === editing.id) return true;
      stack.push(ref);
    }
  }
  return false;
}

// --- mode transitions --------------------------------------------------------

function beginEditing(state: EditorState, prefab: PrefabData): void {
  const ids: string[] = [];
  state.selection.ids.forEach((v) => { ids.push(v); });
  const stash: PrefabStash = {
    world: state.world,
    worldPath: state.worldPath,
    undoStack: state.undoStack,
    redoStack: state.redoStack,
    selectionIds: ids,
    selectionPrimary: state.selection.primary,
    activeTool: state.activeTool,
    placeAssetRef: state.placeAssetRef,
    modified: state.modified,
  };
  state.prefabStash = stash;

  state.editingPrefab = prefab;
  state.world = prefabWorkspace(prefab);
  state.worldPath = null;
  // A separate history. Undoing past the start of prefab mode and landing back
  // inside the world's edits would be indefensible.
  state.undoStack = [];
  state.redoStack = [];
  state.selection.ids.clear();
  state.selection.primary = null;
  state.activeTool = 'select';
  state.modified = false;
  rebuildAllSceneNodes(state);

  // Frame the camera on the PARTS, not on whatever level we just came from. Without
  // this the camera stays pointed at a 200 m arena and a three-prop prefab is three
  // pixels of dust at the origin — which is exactly how it first came up.
  framePrefab(state);
}

/// Point the camera at the prefab's contents. An empty prefab gets a small default
/// box, so the first part you place lands in view instead of behind you.
function framePrefab(state: EditorState): void {
  const ents = state.world.entities;
  if (ents.length === 0) {
    frameCameraOnBounds(state, [-2, 0, -2], [2, 2, 2]);
    return;
  }
  let mnx = 1e9; let mny = 1e9; let mnz = 1e9;
  let mxx = -1e9; let mxy = -1e9; let mxz = -1e9;
  for (let i = 0; i < ents.length; i++) {
    const p = ents[i].transform.position;
    if (p[0] < mnx) mnx = p[0];
    if (p[1] < mny) mny = p[1];
    if (p[2] < mnz) mnz = p[2];
    if (p[0] > mxx) mxx = p[0];
    if (p[1] > mxy) mxy = p[1];
    if (p[2] > mxz) mxz = p[2];
  }
  // Pad, so a single part (a degenerate box) still gets a sane orbit distance.
  const pad = 1.5;
  frameCameraOnBounds(state,
    [mnx - pad, mny - pad, mnz - pad],
    [mxx + pad, mxy + pad + 1.0, mxz + pad]);
}

/// Enter prefab edit mode with a new, empty prefab.
export function enterNewPrefabMode(state: EditorState, id: string, name: string): void {
  if (state.editingPrefab) return;
  beginEditing(state, createEmptyPrefab(id, name));
}

/// Enter prefab edit mode for an existing prefab from the catalog.
export function enterPrefabEditMode(state: EditorState, prefabId: string): void {
  if (state.editingPrefab) return;
  const prefab = state.catalog.prefabs.get(prefabId);
  if (!prefab) return;
  // Deep clone: edits must not touch the catalog copy until Save says so.
  beginEditing(state, JSON.parse(JSON.stringify(prefab)) as PrefabData);
}

/// Leave prefab mode and put the world back exactly as it was.
export function exitPrefabMode(state: EditorState): void {
  const stash = state.prefabStash;
  if (!stash) { state.editingPrefab = null; return; }
  state.world = stash.world;
  state.worldPath = stash.worldPath;
  state.undoStack = stash.undoStack;
  state.redoStack = stash.redoStack;
  state.selection.ids.clear();
  for (let i = 0; i < stash.selectionIds.length; i++) {
    state.selection.ids.add(stash.selectionIds[i]);
  }
  state.selection.primary = stash.selectionPrimary;
  state.activeTool = stash.activeTool;
  state.placeAssetRef = stash.placeAssetRef;
  state.modified = stash.modified;
  state.editingPrefab = null;
  state.prefabStash = null;
  rebuildAllSceneNodes(state);
}

/// Write the prefab to disk and refresh the catalog, so it is immediately placeable
/// without a restart.
export function savePrefabToDisk(state: EditorState): boolean {
  const prefab = state.editingPrefab;
  if (!prefab || !state.project) return false;

  // The children ARE the workspace entities. That is the whole design.
  const n = state.world.entities.length;
  const kids = new Array<PrefabChild>(n);
  for (let i = 0; i < n; i++) kids[i] = entityToChild(state.world.entities[i]);
  prefab.children = kids;

  const path = state.project.prefabsDir + '/' + prefab.id + '.prefab.json';
  const result = savePrefab(path, prefab);
  if (result.ok) {
    state.catalog.prefabs.set(prefab.id, JSON.parse(JSON.stringify(prefab)) as PrefabData);
    if (!state.catalog.prefabOrder.includes(prefab.id)) {
      state.catalog.prefabOrder.push(prefab.id);
    }
    state.modified = false;
  }
  return result.ok;
}

// --- per-frame ---------------------------------------------------------------

export function drawPrefabBreadcrumb(state: EditorState, screenW: number): void {
  if (!state.editingPrefab) return;
  // Over the VIEWPORT, not at x=12 — which is the outliner, and the breadcrumb was
  // landing straight on top of its heading.
  const x = state.viewportLeft + 12;
  const y = Theme.toolbarHeight + 6;
  const n = state.world.entities.length;
  const dirty = state.modified ? ' *' : '';
  const text = 'PREFAB: ' + state.editingPrefab.name + dirty
    + '   (' + n + ' parts)   [Ctrl+S save · ESC exit]';
  drawText(text, x, y, Theme.fontSizeSmall, Theme.textAccent);
}

export function updatePrefabTool(state: EditorState): void {
  if (!state.editingPrefab) return;
  if (isKeyPressed(Key.ESCAPE)) exitPrefabMode(state);
}
