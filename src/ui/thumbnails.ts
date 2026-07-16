// Asset-panel model thumbnails (PLAN §G). Renders each loaded GLB once into a
// 128x128 render texture; the asset panel draws the results as a grid.
//
// Rendering happens INSIDE the normal frame (beginTextureMode switches the
// target and endTextureMode switches back — the raylib idiom the engine
// implements), one thumbnail per frame, and only after the streaming catalog
// has finished loading models so the two pumps never fight over frame time.

import {
  loadRenderTexture, beginTextureMode, endTextureMode, getRenderTextureTexture,
  beginMode3D, endMode3D, drawModel, drawRect,
  Model, Camera3D,
} from 'bloom';
import { EditorState } from '../state/editor-state';
import { Vec3Lit } from 'bloom/world';

export const THUMB_SIZE = 128;

export interface ThumbnailEntry {
  textureHandle: number;   // Texture handle for drawTexturePro. 0 = failed.
  width: number;
  height: number;
}

// Map from model relPath -> thumbnail. Module-scope cache; survives project
// switches harmlessly (keys are relPaths, stale entries just go unused).
const thumbnails = new Map<string, ThumbnailEntry>();
let renderTargetsBroken = false;

// Render at most `maxPerFrame` missing thumbnails. Call between beginDrawing
// and the main 3D pass. Returns the number still missing.
export function pumpThumbnails(state: EditorState, maxPerFrame: number): number {
  if (renderTargetsBroken) return 0;

  let rendered = 0;
  let missing = 0;

  for (let i = 0; i < state.catalog.modelOrder.length; i++) {
    const relPath = state.catalog.modelOrder[i];
    const entry = state.catalog.models.get(relPath);
    if (!entry || !entry.loaded || entry.modelHandle === 0) continue;
    if (thumbnails.has(relPath)) continue;

    if (rendered >= maxPerFrame) {
      missing++;
      continue;
    }

    const rt = loadRenderTexture(THUMB_SIZE, THUMB_SIZE);
    if (rt === 0) {
      // Render targets unavailable on this backend — fall back to text rows
      // forever rather than retrying every frame.
      renderTargetsBroken = true;
      return 0;
    }

    beginTextureMode(rt);
    // Neutral dark backdrop so light and dark models both read.
    drawRect(0, 0, THUMB_SIZE, THUMB_SIZE, { r: 28, g: 30, b: 34, a: 255 });
    beginMode3D(thumbnailCamera(entry.boundsMin, entry.boundsMax));
    const model: Model = { handle: entry.modelHandle } as Model;
    drawModel(model,
      { x: 0, y: 0, z: 0 },
      1,
      { r: 255, g: 255, b: 255, a: 255 });
    endMode3D();
    endTextureMode();

    const tex = getRenderTextureTexture(rt);
    thumbnails.set(relPath, {
      textureHandle: tex.handle,
      width: THUMB_SIZE,
      height: THUMB_SIZE,
    });
    rendered++;
  }

  return missing + (rendered > 0 ? 1 : 0);
}

// Frame the model's AABB from a three-quarter view. Model draws at origin
// with scale 1, so the camera looks at the AABB's own center.
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
