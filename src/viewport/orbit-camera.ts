// Orbit camera: right-drag rotate, middle-drag pan, scroll-wheel zoom.
// Produces a Camera3D suitable for Bloom's beginMode3D each frame.

import {
  isMouseButtonDown, getMouseDeltaX, getMouseDeltaY, getMouseWheel,
  getMouseX, getMouseY, getScreenWidth, getScreenHeight,
  MouseButton,
} from 'bloom';
import { EditorState, OrbitCamera, cameraEyePosition } from '../state/editor-state';
import { mouseToWorldRay, rayPlaneIntersect } from './ray';

const MIN_DISTANCE = 0.2;
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
  if (isMouseButtonDown(MouseButton.RIGHT)) {
    cam.yaw -= dx * ROTATE_SPEED;
    cam.pitch -= dy * ROTATE_SPEED;
    if (cam.pitch < MIN_PITCH) cam.pitch = MIN_PITCH;
    if (cam.pitch > MAX_PITCH) cam.pitch = MAX_PITCH;
    cam.dirty = true;
  }

  // Pan (middle-mouse drag). Move the target in the camera's local XY plane.
  if (isMouseButtonDown(MouseButton.MIDDLE)) {
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

  // Zoom (scroll wheel) — a dolly toward what the CURSOR is over, not toward
  // the orbit target. Zooming used to approach the world center only, so
  // "get close to that house at the edge" required knowing about middle-drag
  // pan first. Gated on the viewport so scrolling a panel no longer also
  // zooms the world.
  if (wheel !== 0) {
    const mx = getMouseX();
    const my = getMouseY();
    const inViewport = mx > state.viewportLeft && mx < state.viewportRight &&
                       my > state.viewportTop && my < state.viewportBottom;
    if (inViewport) {
      // Pivot: where the cursor ray meets the ground plane. Computed BEFORE
      // the distance changes (the ray depends on the eye). Cursor over the
      // sky → no pivot → plain zoom on the current target.
      let pivot: [number, number, number] | null = null;
      if (wheel > 0) {
        const vw = state.viewportRight - state.viewportLeft;
        const vh = state.viewportBottom - state.viewportTop;
        const ray = mouseToWorldRay(cam, mx, my, getScreenWidth(), getScreenHeight(),
          state.viewportLeft, state.viewportTop, vw, vh);
        pivot = rayPlaneIntersect(ray, [0, 0, 0], [0, 1, 0]);
      }

      // Honor multi-notch wheel deltas (trackpads and fast flicks).
      const notches = Math.abs(wheel);
      const factor = Math.pow(ZOOM_SPEED, notches);
      const before = cam.distance;
      if (wheel > 0) cam.distance = cam.distance / factor;
      else cam.distance = cam.distance * factor;
      if (cam.distance < MIN_DISTANCE) cam.distance = MIN_DISTANCE;
      if (cam.distance > MAX_DISTANCE) cam.distance = MAX_DISTANCE;

      // Slide the orbit target toward the pivot by the zoom fraction, so
      // repeated notches converge on the point under the cursor.
      if (pivot !== null && before > 0) {
        const t = 1 - cam.distance / before;
        cam.target[0] += (pivot[0] - cam.target[0]) * t;
        cam.target[1] += (pivot[1] - cam.target[1]) * t;
        cam.target[2] += (pivot[2] - cam.target[2]) * t;
      }
      cam.dirty = true;
    }
  }
}

export { cameraEyePosition };

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
