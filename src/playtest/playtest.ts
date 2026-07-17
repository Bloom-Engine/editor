// Playtest mode — Ctrl+P toggles a first-person fly camera for walkthroughs.
// Hides all editor UI, disables tools and selection, gives WASD + mouse look.

import {
  isKeyDown, isKeyPressed, Key,
  getMouseDeltaX, getMouseDeltaY, getDeltaTime,
  drawText, drawRect, getScreenWidth,
  disableCursor, enableCursor,
} from 'bloom';
import { EditorState } from '../state/editor-state';
import { cameraEyePosition } from '../state/editor-state';
import { Theme } from '../ui/theme';

const FLY_SPEED = 12;
const LOOK_SPEED = 0.003;

export function updatePlaytest(state: EditorState): void {
  // Toggle with Ctrl+P.
  if ((isKeyDown(Key.LEFT_CONTROL) || isKeyDown(Key.LEFT_SUPER)) && isKeyPressed(Key.P)) {
    state.playtesting = !state.playtesting;
    if (state.playtesting) {
      // Enter: set camera to current orbit eye position.
      const eye = cameraEyePosition(state.camera);
      state.camera.target = [eye[0], eye[1], eye[2]];
      state.camera.distance = 0.001; // Collapse orbit to first-person.
      disableCursor();
    } else {
      // Exit: restore orbit distance.
      state.camera.distance = 20;
      enableCursor();
    }
    state.camera.dirty = true;
  }

  if (!state.playtesting) return;

  const dt = getDeltaTime();

  // Mouse look.
  const dx = getMouseDeltaX();
  const dy = getMouseDeltaY();
  state.camera.yaw -= dx * LOOK_SPEED;
  state.camera.pitch -= dy * LOOK_SPEED;
  if (state.camera.pitch < -1.4) state.camera.pitch = -1.4;
  if (state.camera.pitch > 1.4) state.camera.pitch = 1.4;
  state.camera.dirty = true;

  // WASD movement.
  const cosYaw = Math.cos(state.camera.yaw);
  const sinYaw = Math.sin(state.camera.yaw);
  let mx = 0;
  let mz = 0;
  let my = 0;

  if (isKeyDown(Key.W)) { mx += sinYaw; mz += cosYaw; }
  if (isKeyDown(Key.S)) { mx -= sinYaw; mz -= cosYaw; }
  if (isKeyDown(Key.A)) { mx += cosYaw; mz -= sinYaw; }
  if (isKeyDown(Key.D)) { mx -= cosYaw; mz += sinYaw; }
  if (isKeyDown(Key.SPACE)) my += 1;
  if (isKeyDown(Key.LEFT_SHIFT)) my -= 1;

  const speed = FLY_SPEED * dt;
  state.camera.target[0] += mx * speed;
  state.camera.target[1] += my * speed;
  state.camera.target[2] += mz * speed;
}

export function drawPlaytestOverlay(state: EditorState): void {
  if (!state.playtesting) return;
  const sw = getScreenWidth();
  drawRect(0, 0, sw, 28, { r: 20, g: 60, b: 20, a: 200 });
  drawText('PLAYTEST MODE — Ctrl+P to exit — WASD + mouse look', 12, 6, 14, Theme.text);
}
