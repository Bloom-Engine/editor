// Orbit camera: right-drag rotate, middle-drag pan, scroll-wheel zoom.
// Produces a Camera3D suitable for Bloom's beginMode3D each frame.

import {
  isMouseButtonDown, getMouseDeltaX, getMouseDeltaY, getMouseWheel,
  MouseButton,
} from 'bloom';
import { EditorState, OrbitCamera } from '../state/editor-state';

const MIN_DISTANCE = 1;
const MAX_DISTANCE = 500;
const MIN_PITCH = -1.4;
const MAX_PITCH = 1.4;
const ROTATE_SPEED = 0.005;
const PAN_SPEED = 0.01;
const ZOOM_SPEED = 1.1;

export function updateOrbitCamera(state: EditorState): void {
  if (state.playtesting) return;

  const cam = state.camera;
  const dx = getMouseDeltaX();
  const dy = getMouseDeltaY();
  const wheel = getMouseWheel();

  // Rotate (right-mouse drag).
  if (isMouseButtonDown(MouseButton.Right)) {
    cam.yaw -= dx * ROTATE_SPEED;
    cam.pitch -= dy * ROTATE_SPEED;
    if (cam.pitch < MIN_PITCH) cam.pitch = MIN_PITCH;
    if (cam.pitch > MAX_PITCH) cam.pitch = MAX_PITCH;
    cam.dirty = true;
  }

  // Pan (middle-mouse drag). Move the target in the camera's local XY plane.
  if (isMouseButtonDown(MouseButton.Middle)) {
    const speed = cam.distance * PAN_SPEED;
    const cosYaw = Math.cos(cam.yaw);
    const sinYaw = Math.sin(cam.yaw);
    // Right vector (perpendicular to view in XZ plane).
    const rx = cosYaw;
    const rz = -sinYaw;
    // Up vector approximation (ignores pitch for simplicity — good enough).
    const ux = sinYaw * Math.sin(cam.pitch);
    const uy = Math.cos(cam.pitch);
    const uz = cosYaw * Math.sin(cam.pitch);

    cam.target[0] -= (dx * rx + dy * ux) * speed;
    cam.target[1] += dy * uy * speed;
    cam.target[2] -= (dx * rz + dy * uz) * speed;
    cam.dirty = true;
  }

  // Zoom (scroll wheel).
  if (wheel !== 0) {
    if (wheel > 0) {
      cam.distance = cam.distance / ZOOM_SPEED;
    } else {
      cam.distance = cam.distance * ZOOM_SPEED;
    }
    if (cam.distance < MIN_DISTANCE) cam.distance = MIN_DISTANCE;
    if (cam.distance > MAX_DISTANCE) cam.distance = MAX_DISTANCE;
    cam.dirty = true;
  }
}

// Compute the world-space eye position from the orbit parameters.
export function cameraEyePosition(cam: OrbitCamera): [number, number, number] {
  const cosPitch = Math.cos(cam.pitch);
  const sinPitch = Math.sin(cam.pitch);
  const cosYaw = Math.cos(cam.yaw);
  const sinYaw = Math.sin(cam.yaw);

  const x = cam.target[0] + cam.distance * cosPitch * sinYaw;
  const y = cam.target[1] + cam.distance * (-sinPitch);
  const z = cam.target[2] + cam.distance * cosPitch * cosYaw;
  return [x, y, z];
}

// Build a Bloom Camera3D struct from the orbit state.
export function buildCamera3D(cam: OrbitCamera): {
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
  up: { x: number; y: number; z: number };
  fovy: number;
  projection: 'perspective';
} {
  const eye = cameraEyePosition(cam);
  return {
    position: { x: eye[0], y: eye[1], z: eye[2] },
    target: { x: cam.target[0], y: cam.target[1], z: cam.target[2] },
    up: { x: 0, y: 1, z: 0 },
    fovy: cam.fovy,
    projection: 'perspective',
  };
}
