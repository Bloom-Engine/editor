// Auto-frame camera on selection — zooms and pans the orbit camera so the
// selected entity fills the viewport. Triggered by pressing F with an entity
// selected, or automatically after opening a world.

import { EditorState, handleOfEntity, selectedEntityId } from '../state/editor-state';
import { Vec3Lit } from 'bloom/world';

// Frame the camera on a world-space bounding box. Sets the orbit target to
// the box center and adjusts distance so the box fills roughly 60% of the
// viewport vertically.
export function frameCameraOnBounds(
  state: EditorState,
  boundsMin: Vec3Lit,
  boundsMax: Vec3Lit,
): void {
  const cx = (boundsMin[0] + boundsMax[0]) / 2;
  const cy = (boundsMin[1] + boundsMax[1]) / 2;
  const cz = (boundsMin[2] + boundsMax[2]) / 2;

  const sx = boundsMax[0] - boundsMin[0];
  const sy = boundsMax[1] - boundsMin[1];
  const sz = boundsMax[2] - boundsMin[2];
  const maxExtent = Math.max(sx, sy, sz, 1);

  // Distance = extent / tan(fovy/2) * padding factor.
  const fovRad = state.camera.fovy * Math.PI / 180;
  const halfTan = Math.tan(fovRad / 2);
  const distance = (maxExtent / halfTan) * 0.8;

  state.camera.target = [cx, cy, cz];
  state.camera.distance = Math.max(distance, 2);
  state.camera.dirty = true;
}

// Frame the camera on the currently selected entity's model bounds.
export function frameCameraOnSelection(state: EditorState): void {
  if (selectedEntityId(state) === null) return;

  const entity = state.world.entities.find(e => e.id === selectedEntityId(state));
  if (!entity) return;

  // Look up model bounds from the catalog.
  if (entity.modelRef) {
    const entry = state.catalog.models.get(entity.modelRef);
    if (entry) {
      const pos = entity.transform.position;
      const scl = entity.transform.scale;
      const bmin: Vec3Lit = [
        pos[0] + entry.boundsMin[0] * scl[0],
        pos[1] + entry.boundsMin[1] * scl[1],
        pos[2] + entry.boundsMin[2] * scl[2],
      ];
      const bmax: Vec3Lit = [
        pos[0] + entry.boundsMax[0] * scl[0],
        pos[1] + entry.boundsMax[1] * scl[1],
        pos[2] + entry.boundsMax[2] * scl[2],
      ];
      frameCameraOnBounds(state, bmin, bmax);
      return;
    }
  }

  // Fallback: frame on the entity position with a default radius.
  const pos = entity.transform.position;
  frameCameraOnBounds(state, [pos[0] - 2, pos[1] - 2, pos[2] - 2], [pos[0] + 2, pos[1] + 2, pos[2] + 2]);
}

// Frame the camera on the entire world bounds.
export function frameCameraOnWorld(state: EditorState): void {
  frameCameraOnBounds(state, state.world.bounds.min, state.world.bounds.max);
}
