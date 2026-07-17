// Bloom World Editor — entry point.
//
// Wires up the editor state, asset catalog, orbit camera, 3D viewport, world
// sync layer, immediate-mode UI, and tools. This is the top-level compositor
// that orchestrates one frame of the editor.

import {
  initWindow, windowShouldClose, closeWindow,
  beginDrawing, endDrawing, clearBackground,
  beginMode3D, endMode3D,
  setTargetFPS, getDeltaTime, getFPS,
  getScreenWidth, getScreenHeight,
  isKeyPressed, isKeyDown, Key,
  getMouseX, getMouseY,
  isMouseButtonPressed, MouseButton,
  setWindowTitle,
} from 'bloom';

import { createEntity, saveWorld, Vec3Lit } from 'bloom/world';
import { handleSelectClick } from './tools/select-tool';
import { handlePlaceClick } from './tools/place-tool';

import { EditorState, createEditorState, nextEntityId, selectedEntityId } from './state/editor-state';
import { runCommand, undo, redo } from './state/commands';
import { CreateEntityCommand } from './state/commands/create-entity';
import { DestroyEntityCommand } from './state/commands/destroy-entity';
import { DuplicateEntityCommand } from './state/commands/duplicate-entity';
import { RemoveWaterCommand, RemoveRiverCommand } from './state/commands/edit-water';

import { loadProject } from './io/project';
import { loadAssetCatalog, pumpAssetCatalog } from './io/asset-catalog';
import { openWorld, saveCurrentWorld, defaultSavePath } from './io/world-io';

import { updateOrbitCamera, buildCamera3D } from './viewport/orbit-camera';
import { drawGroundGrid, drawWorldAxes } from './viewport/grid';
import { initPicking, updateHover, syncSelectionOutline, pickEntityAtMouse } from './viewport/picking';
import { mouseToWorldRay, rayPlaneIntersect } from './viewport/ray';

import { syncWorldToScene } from './world-sync/sync';

import { createUiContext, uiBeginFrame, uiEndFrame } from './ui/ui-context';
import { createMoveGizmoState, updateMoveGizmo, drawMoveGizmo } from './gizmos/move-gizmo';
import { createRotateGizmoState, updateRotateGizmo, drawRotateGizmo } from './gizmos/rotate-gizmo';
import { createScaleGizmoState, updateScaleGizmo, drawScaleGizmo } from './gizmos/scale-gizmo';
import { createPointGizmoState, updatePointGizmo, drawPointGizmo } from './gizmos/point-gizmo';
import { updateBrushTool } from './tools/brush-tool';
import { updateWaterTool, drawWaterVolumes } from './tools/water-tool';
import { updateRiverTool, drawRiverSplines } from './tools/river-tool';
import { updateLightTool, drawLightMarkers, RemoveLightCommand } from './tools/light-tool';
import {
  updatePrefabTool, drawPrefabBreadcrumb, savePrefabToDisk,
} from './tools/prefab-tool';
import { drawEnvironmentPanel } from './ui/layouts/environment-panel';
import { drawBrushPanel } from './ui/layouts/brush-panel';
import { updatePlaytest, drawPlaytestOverlay } from './playtest/playtest';
import { launchGame } from './playtest/launch';
import { frameCameraOnSelection, frameCameraOnWorld } from './viewport/frame';
import { addRecentProject } from './io/recent';
import { drawToolbar } from './ui/layouts/toolbar';
import { drawAssetPanel } from './ui/layouts/asset-panel';
import { drawInspector } from './ui/layouts/inspector';
import { drawOutliner } from './ui/layouts/outliner';
import { drawRecentPanel } from './ui/layouts/recent-panel';
import { drawStatusBar } from './ui/layouts/status-bar';
import { runThumbnailFrame } from './ui/thumbnails';
import { runSelfTests } from './tests/self-tests';

// ---- self-tests (headless) ---------------------------------------------------

// `bloom-editor --test` runs the suite without opening a window and exits
// nonzero on any failure, so CI and pre-commit hooks can gate on it.
//
// `--project <path>` opens a specific editor.project.json (instead of walking
// up from CWD), and `--world <path>` opens a specific world file — with or
// without a project. Together they let the editor open ANY game's data from
// anywhere, no dialogs: `main --project ../game/editor.project.json` or
// `main --world some/level.world.json`.
let selfTestMode = false;
let argProjectPath: string | null = null;
let argWorldPath: string | null = null;
for (let i = 0; i < process.argv.length; i++) {
  if (process.argv[i] === '--test') selfTestMode = true;
  if (process.argv[i] === '--project' && i + 1 < process.argv.length) {
    argProjectPath = process.argv[i + 1];
  }
  if (process.argv[i] === '--world' && i + 1 < process.argv.length) {
    argWorldPath = process.argv[i + 1];
  }
}
if (selfTestMode) {
  const failures = runSelfTests();
  process.exit(failures > 0 ? 1 : 0);
}

// ---- init ------------------------------------------------------------------

const WINDOW_WIDTH = 1280;
const WINDOW_HEIGHT = 800;

initWindow(WINDOW_WIDTH, WINDOW_HEIGHT, 'Bloom World Editor');
setTargetFPS(60);
initPicking();

const state: EditorState = createEditorState();
const ui = createUiContext();
const moveGizmo = createMoveGizmoState();
const rotateGizmo = createRotateGizmoState();
const scaleGizmo = createScaleGizmoState();
const pointGizmo = createPointGizmoState();

// Load project + assets. The catalog only LISTS models here (instant);
// pumpAssetCatalog in the frame loop streams the GLBs in one per frame, so
// the old ~20 s black window at startup is gone — the world appears at once
// as placeholder boxes and meshes pop in as they load.
loadProject(state, argProjectPath);
loadAssetCatalog(state);

if (state.project !== null) {
  setWindowTitle('Bloom World Editor — ' + state.project.name +
    (state.project.gameId.length > 0 ? ' (' + state.project.gameId + ')' : ''));
}

// Open a world: --world wins, then the project's default.
if (argWorldPath !== null) {
  if (openWorld(state, argWorldPath)) {
    if (state.project) addRecentProject(state.project.name, state.project.filePath);
    frameCameraOnWorld(state);
  } else {
    console.error('could not open --world ' + argWorldPath);
  }
} else if (state.project && state.project.defaultWorld.length > 0) {
  const worldPath = state.project.worldsDir + '/' + state.project.defaultWorld;
  openWorld(state, worldPath);
  addRecentProject(state.project.name, state.project.filePath);
  // Start looking at the level rather than at the default orbit target, which
  // on arena_02 puts the camera inside the building.
  frameCameraOnWorld(state);
}

// Mark environment for initial sync.
state.pendingEnvironmentSync = true;

// Auto-save timer (every 2 minutes).
const AUTOSAVE_INTERVAL = 120; // seconds
let autosaveTimer = 0;

// Models still streaming in (previous frame's count). Thumbnails wait for
// zero so the two per-frame pumps never fight over frame time.
let modelsPending = 1;

// ---- main loop -------------------------------------------------------------

while (!windowShouldClose()) {
  // Thumbnail render frames are currently a no-op (see ui/thumbnails.ts for
  // the two dead ends and the engine work they point to); the hook stays so
  // the burst comes back the day the engine can render a model to a texture.
  if (modelsPending === 0 && !state.playtesting && runThumbnailFrame(state)) {
    continue;
  }

  const dt = getDeltaTime();

  // Auto-save.
  if (state.modified && state.worldPath) {
    autosaveTimer += dt;
    if (autosaveTimer >= AUTOSAVE_INTERVAL) {
      autosaveTimer = 0;
      saveCurrentWorld(state);
    }
  } else {
    autosaveTimer = 0;
  }

  // ---- input shortcuts -----------------------------------------------------

  // Ctrl+Z / Ctrl+Y (undo/redo).
  if (isKeyDown(Key.LEFT_CONTROL) || isKeyDown(Key.LEFT_SUPER)) {
    if (isKeyPressed(Key.Z)) undo(state);
    if (isKeyPressed(Key.Y)) redo(state);
    // In prefab mode Ctrl+S means "save the prefab" — saving the world from inside
    // a prefab would write the neutral authoring stage over the real level.
    if (isKeyPressed(Key.S)) {
      if (state.editingPrefab) savePrefabToDisk(state);
      else saveCurrentWorld(state);
    }
    // Ctrl+R — run the game on this level. (Ctrl+P is already the fly-cam.)
    if (isKeyPressed(Key.R) && !state.editingPrefab) launchGame(state);
  }

  // Delete the selection — entity, water volume, or river. Delete only
  // (Backspace must stay free for text widgets), and never while a widget
  // (text field, drag) is active.
  if (isKeyPressed(Key.DELETE) && ui.activeId === null && state.selection.primary !== null) {
    if (state.selection.kind === 'entity') {
      const entity = state.world.entities.find(e => e.id === state.selection.primary);
      if (entity) {
        const idx = state.world.entities.indexOf(entity);
        runCommand(state, new DestroyEntityCommand(entity, idx));
      }
    } else if (state.selection.kind === 'water') {
      const idx = state.world.water.findIndex(w => w.id === state.selection.primary);
      if (idx >= 0) runCommand(state, new RemoveWaterCommand(state.world.water[idx], idx));
    } else if (state.selection.kind === 'river') {
      const idx = state.world.rivers.findIndex(r => r.id === state.selection.primary);
      if (idx >= 0) runCommand(state, new RemoveRiverCommand(state.world.rivers[idx], idx));
    } else if (state.selection.kind === 'light') {
      const idx = state.world.lights.findIndex(l => l.id === state.selection.primary);
      if (idx >= 0) runCommand(state, new RemoveLightCommand(state.world.lights[idx], idx));
    }
  }

  // Duplicate (Ctrl+D). Entities only.
  if ((isKeyDown(Key.LEFT_CONTROL) || isKeyDown(Key.LEFT_SUPER)) && isKeyPressed(Key.D)) {
    const dupId = selectedEntityId(state);
    if (dupId !== null) {
      const entity = state.world.entities.find(e => e.id === dupId);
      if (entity) {
        runCommand(state, new DuplicateEntityCommand(entity));
      }
    }
  }

  // Tool hotkeys — only when no Ctrl/Cmd chord is held (so Ctrl+Y never
  // doubles as a tool switch) and no widget is active (so typing "q" into a
  // text field doesn't switch tools).
  const chordHeld = isKeyDown(Key.LEFT_CONTROL) || isKeyDown(Key.LEFT_SUPER);
  if (!chordHeld && ui.activeId === null) {
    if (isKeyPressed(Key.Q)) state.activeTool = 'select';
    if (isKeyPressed(Key.W)) state.activeTool = 'place';
    if (isKeyPressed(Key.G)) { state.activeTool = 'transform'; state.transformMode = 'move'; }
    if (isKeyPressed(Key.R)) { state.activeTool = 'transform'; state.transformMode = 'rotate'; }
    if (isKeyPressed(Key.E)) { state.activeTool = 'transform'; state.transformMode = 'scale'; }
    if (isKeyPressed(Key.B)) state.activeTool = 'brush';
    if (isKeyPressed(Key.T)) state.activeTool = 'water';
    if (isKeyPressed(Key.Y)) state.activeTool = 'river';
  }

  // F key: frame camera on selection (or world bounds if nothing selected).
  if (isKeyPressed(Key.F)) {
    if (state.selection.primary !== null) {
      frameCameraOnSelection(state);
    } else {
      frameCameraOnWorld(state);
    }
  }

  // Escape: deselect.
  if (isKeyPressed(Key.ESCAPE)) {
    state.selection.ids.clear();
    state.selection.primary = null;
    syncSelectionOutline(state);
  }

  // ---- playtest mode -------------------------------------------------------

  updatePlaytest(state);

  // ---- prefab tool update --------------------------------------------------

  updatePrefabTool(state);

  if (state.statusMessageT > 0) {
    state.statusMessageT = state.statusMessageT - dt;
    if (state.statusMessageT < 0) state.statusMessageT = 0;
  }

  // ---- camera update -------------------------------------------------------

  updateOrbitCamera(state);

  // ---- begin drawing -------------------------------------------------------

  beginDrawing();
  // Clear to the world's sky color so the environment panel's sky edits are
  // actually visible (the panel used to be a silent no-op here).
  const envSky = state.world.environment.skyColor;
  clearBackground({
    r: Math.floor(envSky[0] * 255),
    g: Math.floor(envSky[1] * 255),
    b: Math.floor(envSky[2] * 255),
    a: 255,
  });

  // ---- 3D viewport ---------------------------------------------------------

  const cam3D = buildCamera3D(state.camera);
  beginMode3D(cam3D);

  drawGroundGrid();
  drawWorldAxes();

  // Update and draw gizmos based on transform mode. The point gizmo covers
  // water / river / light selections, which the entity gizmos bail on.
  updateMoveGizmo(state, moveGizmo);
  updateRotateGizmo(state, rotateGizmo);
  updateScaleGizmo(state, scaleGizmo);
  updatePointGizmo(state, pointGizmo);
  drawMoveGizmo(moveGizmo);
  drawRotateGizmo(rotateGizmo);
  drawScaleGizmo(scaleGizmo);
  drawPointGizmo(state, pointGizmo);

  // In-progress previews for the water/river tools, plus light markers (a light
  // has no mesh, so without these you cannot see or click one).
  drawWaterVolumes(state);
  drawRiverSplines(state);
  drawLightMarkers(state);

  // Note: scene graph nodes are drawn automatically by the engine's retained-
  // mode renderer. We don't need to call drawModel for scene-graph entities.

  endMode3D();

  // ---- viewport mouse handling (after 3D, before 2D UI) --------------------

  // Hover.
  updateHover(state, getMouseX(), getMouseY(), false);

  // Left-click in viewport (only if mouse is inside the viewport area and
  // no UI panel captured it — the UI panels set mouseCaptured below).
  const mx = getMouseX();
  const my = getMouseY();
  const inViewport = mx > state.viewportLeft && mx < state.viewportRight &&
                     my > state.viewportTop && my < state.viewportBottom;

  // We draw UI panels next and check mouseCaptured afterwards. To avoid
  // a one-frame delay, we store the click intent here and process it after UI.
  const viewportClicked = inViewport && isMouseButtonPressed(MouseButton.LEFT);

  // ---- 2D UI (drawn on top of the viewport) --------------------------------

  uiBeginFrame(ui);

  if (!state.playtesting) {
    drawToolbar(ui, state);
    drawOutliner(ui, state);
    drawAssetPanel(ui, state);
    drawInspector(ui, state);
    drawStatusBar(state);
    if (state.editingPrefab) {
      drawPrefabBreadcrumb(state, getScreenWidth());
    }
    // Context-sensitive panels.
    drawBrushPanel(ui, state);
    if (state.activeTool === 'select' && state.selection.primary === null && !state.editingPrefab) {
      drawEnvironmentPanel(ui, state);
    }
    drawRecentPanel(ui, state);
  }
  drawPlaytestOverlay(state);

  uiEndFrame(ui);

  // ---- process viewport click (only if UI didn't capture the mouse) ---------

  if (viewportClicked && !ui.mouseCaptured && !moveGizmo.dragging && !rotateGizmo.dragging && !scaleGizmo.dragging && !pointGizmo.dragging && !pointGizmo.consumedClick) {
    if (state.activeTool === 'place') {
      handlePlaceClick(state);
    } else if (state.activeTool === 'select' || state.activeTool === 'transform') {
      handleSelectClick(state);
    }
  }

  // ---- tools ----------------------------------------------------------------

  updateBrushTool(state);
  updateWaterTool(state);
  updateRiverTool(state);
  updateLightTool(state);

  // ---- stream in pending models (one GLB per frame) --------------------------

  const pendingModels = pumpAssetCatalog(state, 1);
  modelsPending = pendingModels;
  if (pendingModels > 0) {
    state.statusMessage = 'Loading models… ' + pendingModels + ' remaining';
    state.statusMessageT = 0.5;
  }

  // ---- world sync (at the end of the frame) --------------------------------

  syncWorldToScene(state);

  // ---- finish --------------------------------------------------------------

  endDrawing();
}

// The window is closing. Losing edits silently is unacceptable — but so is
// silently overwriting the real file with changes the user may have been
// abandoning on purpose. Park them in a sibling recovery file instead;
// openWorld announces it on the next launch. (Skipped in prefab mode: the
// stashed WORLD is what matters there and it hasn't been touched.)
if (state.modified && state.worldPath !== null && !state.editingPrefab) {
  const recoverPath = state.worldPath + '.recover';
  const res = saveWorld(recoverPath, state.world);
  if (res.ok) {
    console.error('editor: window closed with unsaved changes — parked in ' + recoverPath);
  }
}

closeWindow();
