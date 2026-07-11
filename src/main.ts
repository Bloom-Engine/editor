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

import { createEntity, Vec3Lit } from 'bloom/world';
import { handleSelectClick } from './tools/select-tool';
import { handlePlaceClick } from './tools/place-tool';

import { EditorState, createEditorState, nextEntityId } from './state/editor-state';
import { runCommand, undo, redo } from './state/commands';
import { CreateEntityCommand } from './state/commands/create-entity';
import { DestroyEntityCommand } from './state/commands/destroy-entity';
import { DuplicateEntityCommand } from './state/commands/duplicate-entity';

import { loadProject } from './io/project';
import { loadAssetCatalog } from './io/asset-catalog';
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
import { updateBrushTool } from './tools/brush-tool';
import { updateWaterTool, drawWaterVolumes } from './tools/water-tool';
import { updateRiverTool, drawRiverSplines } from './tools/river-tool';
import { updatePrefabTool, drawPrefabBreadcrumb } from './tools/prefab-tool';
import { drawEnvironmentPanel } from './ui/layouts/environment-panel';
import { drawBrushPanel } from './ui/layouts/brush-panel';
import { updatePlaytest, drawPlaytestOverlay } from './playtest/playtest';
import { frameCameraOnSelection, frameCameraOnWorld } from './viewport/frame';
import { addRecentProject } from './io/recent';
import { drawToolbar } from './ui/layouts/toolbar';
import { drawAssetPanel } from './ui/layouts/asset-panel';
import { drawInspector } from './ui/layouts/inspector';
import { drawOutliner } from './ui/layouts/outliner';
import { drawStatusBar } from './ui/layouts/status-bar';

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

// Load project + assets.
loadProject(state);
loadAssetCatalog(state);

// Open default world if available.
if (state.project && state.project.defaultWorld.length > 0) {
  const worldPath = state.project.worldsDir + '/' + state.project.defaultWorld;
  openWorld(state, worldPath);
  addRecentProject(state.project.name, state.project.filePath);
}

// Mark environment for initial sync.
state.pendingEnvironmentSync = true;

// Auto-save timer (every 2 minutes).
const AUTOSAVE_INTERVAL = 120; // seconds
let autosaveTimer = 0;

// ---- main loop -------------------------------------------------------------

while (!windowShouldClose()) {
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
  if (isKeyDown(Key.LeftControl) || isKeyDown(Key.LeftSuper)) {
    if (isKeyPressed(Key.Z)) undo(state);
    if (isKeyPressed(Key.Y)) redo(state);
    if (isKeyPressed(Key.S)) saveCurrentWorld(state);
  }

  // Delete selected entity.
  if (isKeyPressed(Key.Delete) || isKeyPressed(Key.Backspace)) {
    if (state.selection.primary !== null) {
      const entity = state.world.entities.find(e => e.id === state.selection.primary);
      if (entity) {
        const idx = state.world.entities.indexOf(entity);
        runCommand(state, new DestroyEntityCommand(entity, idx));
      }
    }
  }

  // Duplicate (Ctrl+D).
  if ((isKeyDown(Key.LeftControl) || isKeyDown(Key.LeftSuper)) && isKeyPressed(Key.D)) {
    if (state.selection.primary !== null) {
      const entity = state.world.entities.find(e => e.id === state.selection.primary);
      if (entity) {
        runCommand(state, new DuplicateEntityCommand(entity));
      }
    }
  }

  // Tool hotkeys.
  if (isKeyPressed(Key.Q)) state.activeTool = 'select';
  if (isKeyPressed(Key.W)) state.activeTool = 'place';
  if (isKeyPressed(Key.G)) { state.activeTool = 'transform'; state.transformMode = 'move'; }
  if (isKeyPressed(Key.R)) { state.activeTool = 'transform'; state.transformMode = 'rotate'; }
  if (isKeyPressed(Key.E)) { state.activeTool = 'transform'; state.transformMode = 'scale'; }
  if (isKeyPressed(Key.B)) state.activeTool = 'brush';
  if (isKeyPressed(Key.T)) state.activeTool = 'water';
  if (isKeyPressed(Key.Y)) state.activeTool = 'river';

  // F key: frame camera on selection (or world bounds if nothing selected).
  if (isKeyPressed(Key.F)) {
    if (state.selection.primary !== null) {
      frameCameraOnSelection(state);
    } else {
      frameCameraOnWorld(state);
    }
  }

  // Escape: deselect.
  if (isKeyPressed(Key.Escape)) {
    state.selection.ids.clear();
    state.selection.primary = null;
    syncSelectionOutline(state);
  }

  // ---- playtest mode -------------------------------------------------------

  updatePlaytest(state);

  // ---- prefab tool update --------------------------------------------------

  updatePrefabTool(state);

  // ---- camera update -------------------------------------------------------

  updateOrbitCamera(state);

  // ---- begin drawing -------------------------------------------------------

  beginDrawing();
  clearBackground({ r: 42, g: 46, b: 56, a: 255 });

  // ---- 3D viewport ---------------------------------------------------------

  const cam3D = buildCamera3D(state.camera);
  beginMode3D(cam3D);

  drawGroundGrid();
  drawWorldAxes();

  // Update and draw gizmos based on transform mode.
  updateMoveGizmo(state, moveGizmo);
  updateRotateGizmo(state, rotateGizmo);
  updateScaleGizmo(state, scaleGizmo);
  drawMoveGizmo(moveGizmo);
  drawRotateGizmo(rotateGizmo);
  drawScaleGizmo(scaleGizmo);

  // Draw water volumes and river splines as immediate-mode overlays.
  drawWaterVolumes(state);
  drawRiverSplines(state);

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
  const viewportClicked = inViewport && isMouseButtonPressed(MouseButton.Left);

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
  }
  drawPlaytestOverlay(state);

  uiEndFrame(ui);

  // ---- process viewport click (only if UI didn't capture the mouse) ---------

  if (viewportClicked && !ui.mouseCaptured && !moveGizmo.dragging && !rotateGizmo.dragging && !scaleGizmo.dragging) {
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

  // ---- world sync (at the end of the frame) --------------------------------

  syncWorldToScene(state);

  // ---- finish --------------------------------------------------------------

  endDrawing();
}

closeWindow();
