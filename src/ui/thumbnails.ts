// Asset-panel model thumbnails (PLAN §G) — render pass currently DISABLED.
//
// The first implementation called beginTextureMode/endTextureMode mid-frame,
// raylib-style. The engine's render targets don't work that way: the override
// set by begin_texture_mode is consumed at END_FRAME ("the next end_frame will
// render to this texture view instead of the surface" — renderer/mod.rs), and
// 2D draws batch for the frame. So the thumbnail textures stayed empty and the
// grid drew invisible images over dark panel — screenshot-verified 2026-07-16.
//
// Rendering a mesh into a texture on this engine needs either (a) a dedicated
// whole frame per thumbnail with the world's scene nodes hidden, or (b) a real
// engine-side render-mesh-to-texture utility. Until one of those exists, the
// asset panel draws colored placeholder cells (visible, clickable, labeled) —
// see asset-panel.ts. The API here stays so the grid lights up the day the
// engine call exists.

import { EditorState } from '../state/editor-state';

export const THUMB_SIZE = 128;

export interface ThumbnailEntry {
  textureHandle: number;
  width: number;
  height: number;
}

// No-op while the render pass is disabled. Returns 0 = "nothing pending" so
// main.ts never waits on it.
export function pumpThumbnails(_state: EditorState, _maxPerFrame: number): number {
  return 0;
}

// Always null while the render pass is disabled — the asset panel then draws
// its colored placeholder cell.
export function getThumbnail(_relPath: string): ThumbnailEntry | null {
  return null;
}
