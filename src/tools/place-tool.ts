// Place tool — click in the viewport to place the currently selected asset
// (from the asset panel) at the ground plane or terrain hit point.

import { getMouseX, getMouseY, getScreenWidth, getScreenHeight } from 'bloom';
import { createEntity, Vec3Lit } from 'bloom/world';
import { sampleHeight } from 'bloom/world';
import { EditorState, nextEntityId } from '../state/editor-state';
import { CreateEntityCommand } from '../state/commands/create-entity';
import { runCommand } from '../state/commands';
import { mouseToWorldRay, rayPlaneIntersect } from '../viewport/ray';

export function handlePlaceClick(state: EditorState): void {
  if (state.activeTool !== 'place' || state.placeAssetRef === null) return;

  const mx = getMouseX();
  const my = getMouseY();
  const vw = state.viewportRight - state.viewportLeft;
  const vh = state.viewportBottom - state.viewportTop;
  const ray = mouseToWorldRay(
    state.camera, mx, my,
    getScreenWidth(), getScreenHeight(),
    state.viewportLeft, state.viewportTop, vw, vh,
  );

  // Hit the ground plane (y=0) or terrain surface.
  let hitPoint = rayPlaneIntersect(ray, [0, 0, 0], [0, 1, 0]);
  if (!hitPoint) return;

  // Snap to terrain height if terrain exists.
  if (state.world.terrain) {
    const terrainY = sampleHeight(state.world.terrain, hitPoint[0], hitPoint[2]);
    hitPoint = [hitPoint[0], terrainY, hitPoint[2]];
  }

  const id = nextEntityId(state);
  const ref = state.placeAssetRef;
  const isPrefab = ref.startsWith('prefab:');
  const modelRef = isPrefab ? null : ref;
  const prefabRef = isPrefab ? ref.substring(7) : null;

  const entity = createEntity(id, modelRef || '', hitPoint as Vec3Lit);
  if (isPrefab) {
    entity.modelRef = null;
    entity.prefabRef = prefabRef;
    entity.name = prefabRef || 'prefab';
  }

  runCommand(state, new CreateEntityCommand(entity));
}
