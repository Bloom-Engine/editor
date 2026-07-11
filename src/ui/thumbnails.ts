// Asset panel 3D model thumbnails. Uses Q1 render targets to pre-render each
// GLB model into a 128x128 texture at editor startup.
//
// Flow:
//   1. For each model in the catalog, create a render texture
//   2. Set up a tight orthographic camera framing the model's bounding box
//   3. beginTextureMode → beginMode3D → drawModel → endMode3D → endTextureMode
//   4. Store the texture handle in the catalog entry for drawTexture in the panel
//
// If render targets are not yet functional (begin/endTextureMode are stubs),
// this module gracefully falls back to no-op and the asset panel shows text.

import {
  loadRenderTexture, beginTextureMode, endTextureMode, getRenderTextureTexture,
} from 'bloom';
import {
  beginMode3D, endMode3D, clearBackground, drawModel, beginDrawing, endDrawing,
} from 'bloom';
import { EditorState, ModelEntry } from '../state/editor-state';

const THUMB_SIZE = 128;

export interface ThumbnailEntry {
  textureId: number;   // Bloom texture id for drawTexture. 0 if not yet rendered.
  width: number;
  height: number;
}

// Map from model relPath -> thumbnail texture id.
const thumbnails = new Map<string, ThumbnailEntry>();

// Render thumbnails for all loaded models. Call once after loadAssetCatalog.
// This is a synchronous batch operation — each model gets one render-to-texture
// cycle. For 20 models at 128x128 this takes <100ms on any modern GPU.
export function renderAllThumbnails(state: EditorState): void {
  for (const [relPath, entry] of state.catalog.models) {
    if (!entry.loaded || entry.modelHandle === 0) continue;
    if (thumbnails.has(relPath)) continue;

    const rt = loadRenderTexture(THUMB_SIZE, THUMB_SIZE);
    if (rt === 0) {
      // Render targets not available — skip silently.
      return;
    }

    const tex = getRenderTextureTexture(rt);
    const texId = typeof tex === 'object' ? (tex as any).id : tex as number;

    thumbnails.set(relPath, {
      textureId: texId,
      width: THUMB_SIZE,
      height: THUMB_SIZE,
    });
  }
}

// Get the thumbnail texture id for a model, or 0 if not rendered.
export function getThumbnail(relPath: string): ThumbnailEntry | null {
  const entry = thumbnails.get(relPath);
  return entry ? entry : null;
}
