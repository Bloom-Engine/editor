// Asset-panel model thumbnails (PLAN §G) — real renders, via DEDICATED frames.
//
// The engine's render-target override is per-frame: begin_texture_mode arms
// it and end_frame renders the WHOLE frame into the texture (no present).
// The deferred path ignored the override until 2026-07-17 (engine
// feat/render-to-texture) — that's why two earlier attempts drew nothing.
//
// Once the streaming catalog settles, main.ts hands whole frames over to
// runThumbnailFrame: each one hides the world's scene nodes, draws a single
// model with neutral studio lighting, arms the override, and ends the frame
// into a 128px texture. The screen holds the last presented frame during the
// burst (~half a second for a 26-model catalog, right after load).

import {
  loadRenderTexture, beginTextureMode, endTextureMode, getRenderTextureTexture,
  beginDrawing, endDrawing, clearBackground,
  beginMode3D, endMode3D, drawModel, drawModelTransform, setSceneNodeVisible,
  setAmbientLight, setDirectionalLight, vec3,
  Model, Camera3D,
} from 'bloom';
import { EditorState } from '../state/editor-state';
import { Vec3Lit } from 'bloom/world';
import { mat4Identity } from 'bloom';
import {
  createPrefabRegistry, registerPrefab, expandPrefab, PrefabLeaf,
} from 'bloom/world';

export const THUMB_SIZE = 128;

export interface ThumbnailEntry {
  textureHandle: number;
  width: number;
  height: number;
}

// relPath -> thumbnail. Module-scope cache; stale keys from a previous
// project just go unused.
const thumbnails = new Map<string, ThumbnailEntry>();
let renderTargetsBroken = false;
let worldHidden = false;

// Render ONE pending thumbnail as a dedicated frame. Returns true when it
// consumed the frame (main.ts must then skip its normal frame entirely).
// Returns false when there is nothing left to do — and un-hides the world
// on that transition.
export function runThumbnailFrame(state: EditorState): boolean {
  if (renderTargetsBroken) {
    if (worldHidden) setWorldVisible(state, true);
    return false;
  }

  // Find the next loaded model with no thumbnail yet.
  let relPath: string | null = null;
  let modelHandle = 0;
  let bmin: Vec3Lit = [0, 0, 0];
  let bmax: Vec3Lit = [0, 0, 0];
  for (let i = 0; i < state.catalog.modelOrder.length; i++) {
    const entry = state.catalog.models.get(state.catalog.modelOrder[i]);
    if (!entry || !entry.loaded || entry.modelHandle === 0) continue;
    if (thumbnails.has(entry.relPath)) continue;
    relPath = entry.relPath;
    modelHandle = entry.modelHandle;
    bmin = entry.boundsMin;
    bmax = entry.boundsMax;
    break;
  }

  if (relPath === null) {
    // All models done — prefabs next (keyed 'prefab:<id>'; they need the
    // models loaded, which is why they queue behind them).
    if (runPrefabThumbnailFrame(state)) return true;
    if (worldHidden) setWorldVisible(state, true);
    return false;
  }

  const rt = loadRenderTexture(THUMB_SIZE, THUMB_SIZE);
  if (rt === 0) {
    renderTargetsBroken = true;
    if (worldHidden) setWorldVisible(state, true);
    console.error('thumbnails: render targets unavailable — keeping placeholder cells');
    return false;
  }

  if (!worldHidden) setWorldVisible(state, false);

  beginDrawing();
  clearBackground({ r: 24, g: 26, b: 31, a: 255 });

  // The renderer cleared its lighting block in begin_frame; give the
  // thumbnail a neutral studio setup instead of the world's environment.
  setAmbientLight({ r: 255, g: 255, b: 255, a: 255 }, 0.55);
  setDirectionalLight(vec3(-0.5, -1.0, -0.35),
    { r: 255, g: 250, b: 240, a: 255 }, 1.1);

  beginMode3D(thumbnailCamera(bmin, bmax));
  const model: Model = { handle: modelHandle } as Model;
  drawModel(model, { x: 0, y: 0, z: 0 }, 1, { r: 255, g: 255, b: 255, a: 255 });
  endMode3D();

  // Arm the override: THIS frame's end_frame renders into the texture
  // (and does not present — the screen keeps the last real frame).
  beginTextureMode(rt);
  endDrawing();
  endTextureMode();

  const tex = getRenderTextureTexture(rt);
  thumbnails.set(relPath, {
    textureHandle: tex.handle,
    width: THUMB_SIZE,
    height: THUMB_SIZE,
  });
  return true;
}

// One prefab thumbnail per frame: expand the prefab into its model leaves,
// frame their combined world-space AABB, and draw each leaf at its matrix.
// Prefabs whose leaves have no loaded models get a sentinel entry (handle 0)
// so we never retry — the grid keeps its colored cell for those.
function runPrefabThumbnailFrame(state: EditorState): boolean {
  for (let i = 0; i < state.catalog.prefabOrder.length; i++) {
    const prefabId = state.catalog.prefabOrder[i];
    const key = 'prefab:' + prefabId;
    if (thumbnails.has(key)) continue;

    const registry = createPrefabRegistry();
    for (const [, p] of state.catalog.prefabs) registerPrefab(registry, p);

    const leaves: PrefabLeaf[] = [];
    const errors: string[] = [];
    const visited = new Set<string>();
    expandPrefab(registry, prefabId, mat4Identity(), null, [], leaves, errors, visited, prefabId);

    // Combined AABB of the leaves' transformed model bounds.
    let any = false;
    let minX = 0, minY = 0, minZ = 0, maxX = 0, maxY = 0, maxZ = 0;
    for (let li = 0; li < leaves.length; li++) {
      const me = state.catalog.models.get(leaves[li].modelRef);
      if (!me || !me.loaded || me.modelHandle === 0) continue;
      const m = leaves[li].worldMatrix;
      for (let corner = 0; corner < 8; corner++) {
        const px = (corner & 1) !== 0 ? me.boundsMax[0] : me.boundsMin[0];
        const py = (corner & 2) !== 0 ? me.boundsMax[1] : me.boundsMin[1];
        const pz = (corner & 4) !== 0 ? me.boundsMax[2] : me.boundsMin[2];
        // Column-major 4x4 * point.
        const wx = m[0] * px + m[4] * py + m[8] * pz + m[12];
        const wy = m[1] * px + m[5] * py + m[9] * pz + m[13];
        const wz = m[2] * px + m[6] * py + m[10] * pz + m[14];
        if (!any) {
          minX = wx; maxX = wx; minY = wy; maxY = wy; minZ = wz; maxZ = wz;
          any = true;
        } else {
          if (wx < minX) minX = wx;
          if (wx > maxX) maxX = wx;
          if (wy < minY) minY = wy;
          if (wy > maxY) maxY = wy;
          if (wz < minZ) minZ = wz;
          if (wz > maxZ) maxZ = wz;
        }
      }
    }

    if (!any) {
      // Nothing renderable (empty prefab / models missing) — sentinel, no retry.
      thumbnails.set(key, { textureHandle: 0, width: THUMB_SIZE, height: THUMB_SIZE });
      continue;
    }

    const rt = loadRenderTexture(THUMB_SIZE, THUMB_SIZE);
    if (rt === 0) {
      renderTargetsBroken = true;
      if (worldHidden) setWorldVisible(state, true);
      return false;
    }

    if (!worldHidden) setWorldVisible(state, false);

    beginDrawing();
    clearBackground({ r: 24, g: 26, b: 31, a: 255 });
    setAmbientLight({ r: 255, g: 255, b: 255, a: 255 }, 0.55);
    setDirectionalLight(vec3(-0.5, -1.0, -0.35),
      { r: 255, g: 250, b: 240, a: 255 }, 1.1);

    beginMode3D(thumbnailCamera([minX, minY, minZ], [maxX, maxY, maxZ]));
    for (let li = 0; li < leaves.length; li++) {
      const me = state.catalog.models.get(leaves[li].modelRef);
      if (!me || !me.loaded || me.modelHandle === 0) continue;
      const t = leaves[li].tint;
      const color = t !== null
        ? { r: Math.floor(t[0] * 255), g: Math.floor(t[1] * 255), b: Math.floor(t[2] * 255), a: 255 }
        : { r: 255, g: 255, b: 255, a: 255 };
      drawModelTransform({ handle: me.modelHandle } as Model, leaves[li].worldMatrix, color);
    }
    endMode3D();

    beginTextureMode(rt);
    endDrawing();
    endTextureMode();

    const tex = getRenderTextureTexture(rt);
    thumbnails.set(key, { textureHandle: tex.handle, width: THUMB_SIZE, height: THUMB_SIZE });
    return true;
  }
  return false;
}

// Force a prefab's thumbnail to regenerate (called after a prefab is saved).
export function invalidatePrefabThumbnail(prefabId: string): void {
  thumbnails.delete('prefab:' + prefabId);
}

// Hide/show everything the world has put in the retained scene graph, so a
// thumbnail frame contains ONLY the model being photographed.
function setWorldVisible(state: EditorState, visible: boolean): void {
  worldHidden = !visible;
  for (const handle of state.handles.byEntity.values()) {
    setSceneNodeVisible(handle, visible);
  }
  if (state.terrainHandle !== 0) setSceneNodeVisible(state.terrainHandle, visible);
  for (let i = 0; i < state.waterHandles.length; i++) {
    if (state.waterHandles[i] !== 0) setSceneNodeVisible(state.waterHandles[i], visible);
  }
  for (let i = 0; i < state.riverHandles.length; i++) {
    if (state.riverHandles[i] !== 0) setSceneNodeVisible(state.riverHandles[i], visible);
  }
}

// Frame the model's AABB from a three-quarter view.
function thumbnailCamera(bmin: Vec3Lit, bmax: Vec3Lit): Camera3D {
  const cx = (bmin[0] + bmax[0]) / 2;
  const cy = (bmin[1] + bmax[1]) / 2;
  const cz = (bmin[2] + bmax[2]) / 2;
  const dx = bmax[0] - bmin[0];
  const dy = bmax[1] - bmin[1];
  const dz = bmax[2] - bmin[2];
  let r = Math.sqrt(dx * dx + dy * dy + dz * dz) / 2;
  if (r < 0.001) r = 1;

  return {
    position: { x: cx + r * 1.7, y: cy + r * 1.2, z: cz + r * 1.7 },
    target: { x: cx, y: cy, z: cz },
    up: { x: 0, y: 1, z: 0 },
    fovy: 40,
    projection: 'perspective',
  };
}

// The thumbnail for a model, or null when not (yet) rendered.
export function getThumbnail(relPath: string): ThumbnailEntry | null {
  const entry = thumbnails.get(relPath);
  if (entry === undefined) return null;
  return entry;
}
