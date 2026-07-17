// Asset-panel model thumbnails (PLAN §G) — render pass DISABLED, twice over.
// The asset panel draws category-colored cells instead (visible, clickable,
// labeled); getThumbnail below always returns null and the grid falls back.
//
// What was tried, and what each attempt established (2026-07-16/17):
//
// 1. MID-FRAME beginTextureMode/endTextureMode, raylib-style: the engine's
//    override is per-frame — begin_texture_mode arms it and only end_frame
//    consumes it (renderer/mod.rs), so clearing it mid-frame renders nothing.
//    Result: empty textures, invisible cells (screenshot-verified).
//
// 2. DEDICATED FRAMES: hide the world's scene nodes, draw one model, arm the
//    override, endDrawing → the whole frame renders into the 128px target
//    with no present. The frame pipeline demonstrably ENGAGES (the GI
//    backend re-selects during the burst) and the world hide/unhide works —
//    but the texture still draws as nothing in the 2D layer: even a bare
//    magenta clearBackground never shows up when the texture is drawn via
//    drawTexturePro (screenshot-verified). So either the compose pass does
//    not write the RT the way begin_texture_mode's docs suggest, or 2D
//    sampling of an RT texture is broken (bind group / alpha).
//
// Conclusion: this needs a focused ENGINE session — ideally a purpose-built
// `renderModelToTexture(model, camera, size)` that runs a self-contained
// simple pass, plus a golden test that round-trips a rendered texture
// through drawTexturePro. Editor-side scaffolding (dedicated-frame burst,
// world hide/unhide, framing camera) lives in git history at commit ab43000^
// ..HEAD and can be resurrected the day the engine call exists.

export const THUMB_SIZE = 128;

export interface ThumbnailEntry {
  textureHandle: number;
  width: number;
  height: number;
}

import { EditorState } from '../state/editor-state';

// No-op while the render pass is disabled: nothing pending, ever.
export function runThumbnailFrame(_state: EditorState): boolean {
  return false;
}

// Always null — the asset panel then draws its colored placeholder cell.
export function getThumbnail(_relPath: string): ThumbnailEntry | null {
  return null;
}
