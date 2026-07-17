# Bloom World Editor — Audit & Completion Plan

**Date:** 2026-07-11 · **Toolchain:** Perry 0.5.1239 · **Status (updated 2026-07-15):** MOSTLY DONE — the ✅ markers through the body are
accurate; this header was not. A/B/C/D/E/F1 and play-in-editor have shipped (and are
now pushed — they sat committed on one machine's local `main` until 2026-07-15).
**Status update 2026-07-16:** the outstanding list is now EMPTY apart from
slivers. Shipped 2026-07-16 on `feat/editor-completion`: **F2** (rename / tint /
tags / modelRef-with-Apply, all undoable), **F3** (outliner scrolls + filter
box; rename lives in the inspector, per-row ops remain the selection + Delete /
Ctrl+D paths), **I** (full env schema incl. sunColor/ambientColor/fogColor,
per-field-coalescing `SetEnvironmentCommand`), **§C tail** (point gizmo: water
move/scale, per-control-point river handles, light move), **H** (Recent button
→ panel → whole-project switch), **G** (model thumbnails via render-to-texture,
one per frame; *prefab-tab thumbnails are the remaining sliver*), **P5** (the
catalog streams — one GLB per frame, placeholders pop into meshes; the ~20 s
black window is gone), plus `--project`/`--world` CLI args and the
dxcompiler.dll discovery (see README — the editor previously could not START
outside a directory carrying the DX12 compiler DLLs). **K2** stays void/optional
(a `postSaveCommand` key remains unimplemented by choice); **J** stays stretch.
~~**K1**~~ shipped 2026-07-15 (evening) — see the correction at §K1.

**Part 4 (added 2026-07-15) extends scope:** the editor should edit **any world
for any game** that uses the world format. Phase 1 (file trust) landed
2026-07-15; **P2 (contract) and P3a (world-viewer) landed 2026-07-16** — see
the Part 4 status notes. P3b (garden port) is the one open decision.

This document is self-contained: it is written for an implementer with no prior context. It replaces the original design plan (which was deleted). Part 1 is a verified audit of the current state, Part 2 defines "done", Part 3 is the work plan. This is a **single unified scope** — do not cut it down to an MVP; if a task has a prerequisite, the prerequisite is in scope too.

---

## Part 0 — Orientation

**What this is:** an open-world editor for the Bloom engine. It authors `*.world.json` / `*.prefab.json` files (schema defined in the engine's shared world module) that Bloom games load. The primary compatibility target is the shooter's worlds — the editor must open, edit, and losslessly re-save `../shooter/assets/worlds/arena_01.world.json` and `arena_02.world.json`.

**Ecosystem paths** (siblings of this repo):

| Path | What |
|---|---|
| `../engine/` | Bloom engine: TypeScript API over a Rust/wgpu native library (412 FFI functions listed in `../engine/package.json` under `perry.nativeLibrary.functions`). Shared world module at `../engine/src/world/`. |
| `../shooter/` | Arena FPS. Worlds in `assets/worlds/`, editor project file `editor.project.json` at its root. Its `docs/perry-quirks.md` documents historical Perry bugs (now fixed — see §1.6). |
| `../garden/` | 3D collectathon. **Correction 2026-07-15:** the claim that it is *"the only game using the runtime `loadWorld`/`instantiateWorld` path"* is FALSE — garden references neither, nor `bloom/world`, nor any `.world.json` (it predates the world module). **`instantiateWorld` has ZERO game consumers**: only the editor and the engine's own modules. This matters — §C1's acceptance ("garden instantiating a world with water/rivers shows them") was never executable, so the "a river cannot look different in-game than in the editor" guarantee is UNTESTED. |
| Perry (installed as `perry` on PATH; source checkout is a sibling of the `bloom/` tree) | The TypeScript→native AOT compiler that builds everything here. |

**Build & run:**

```sh
cd editor
PERRY_ALLOW_PERRY_FEATURES=1 perry compile src/main.ts   # until task A1 lands
./main
```

Perry 0.5 notes: the CLI is `perry compile <entry>` (there is no `perry build`); it emits `./main` and ignores `perry.toml`'s `out_dir`. Duplicate-symbol `ld` warnings (perry_stdlib vs libbloom_macos both embedding Rust std) are benign — the editor compiles and links clean as of 0.5.1239. The stale `bloom-editor` binary from April 2026 predates all of this.

~~This directory is **not a git repository** and has no history.~~ **Corrected
2026-07-15:** it is a git repository with history, and as of today it is pushed to
`origin/main`. (For a while the reverse hazard applied: three commits of real work —
prefab authoring, play-in-editor, terrain painting — existed only in this local
clone. If a PLAN item reads "done", check it is *pushed*.)

---

## Part 1 — Audit (verified 2026-07-11)

Everything below was verified by reading current source, not from stale docs. Codebase: ~4,400 LOC TypeScript across 41 files under `src/`.

### 1.1 What works

| Area | Status |
|---|---|
| Place / select tools | Complete (`src/tools/place-tool.ts`, `select-tool.ts`) — raycast placement with terrain-height snap, shift multi-select |
| Move / rotate / scale gizmos | Complete (`src/gizmos/`) — per-axis drag, snapping, merged undo commands; toolbar + G/R/E hotkeys |
| Terrain sculpt (raise/lower/smooth/flatten) | Complete, undoable (`src/tools/brush-tool.ts`, `src/ui/layouts/brush-panel.ts`) |
| Undo/redo stack | Complete and the most solid subsystem (`src/state/commands.ts` + `src/state/commands/*`); drag coalescing via `mergeWith`; covered by self-tests |
| Save / load / autosave | Complete (`src/io/world-io.ts` wraps engine `loadWorld`/`saveWorld`; 120 s autosave; Ctrl+S; toolbar New/Open/Save via native file dialogs in `src/ui/dialogs.ts`) |
| World-sync | Complete (`src/world-sync/sync.ts`, runs every frame): entity create/update/destroy, terrain mesh rebuild, prefab expansion, environment sync |
| Playtest | Complete for its scope (`src/playtest/playtest.ts`): Ctrl+P fly-cam, mouse-look, cursor lock, UI hidden |
| Environment panel | Functional (`src/ui/layouts/environment-panel.ts`): sky color, sun dir/intensity, ambient intensity, fog start/end, shadows toggle — but see §1.2 (not undoable) and §3.I (missing fields) |
| Outliner / inspector / asset panel | Functional but shallow — flat list, click-select; inspector shows name/id/transform/tags only; asset panel is text rows |

### 1.2 Verified bugs

1. **Ctrl+Y both redoes and switches to the river tool.** Redo fires at `src/main.ts:113` inside the Ctrl-held block; the river hotkey at `src/main.ts:146` (`if (isKeyPressed(Key.Y)) state.activeTool = 'river';`) is not gated on Ctrl being up, so both run in the same frame. All tool hotkeys in the block at `src/main.ts:139-146` have the same latent problem (Q/W/G/R/E/B/T/Y fire even with Ctrl/Cmd held); only Y collides with an existing chord today.
2. **Entities whose model can't load are silently invisible and unpickable.** In `syncRebuilds` (`src/world-sync/sync.ts:65-81`), if the catalog has no loaded model for `entity.modelRef`, no scene node is created and no handle is bound — the entity exists only as an outliner row. This breaks shooter worlds outright: every gameplay entity in `arena_02` (4 enemy spawners, 4 weapon pickups, 4 collider boxes, 5 point lights, player spawns, wave config — ~20 entities) uses the sentinel `modelRef: "assets/models/_gizmo_box.glb"`, **which does not exist on disk** (verified). It's a convention shooter's baker special-cases (`MODEL_IS_BOX` → draw a colored cube); the editor has no equivalent.
3. **Water volumes and rivers cannot be selected, inspected, or deleted after placement.** The selection model and inspector only know entities (`src/ui/layouts/inspector.ts` reads only `state.world.entities`); the only way to remove a just-placed volume is immediate undo. All water/river parameters are hardcoded at creation (`src/tools/water-tool.ts` ~63-71, `src/tools/river-tool.ts` ~80-87) with no settings UI anywhere.
4. **Environment edits bypass the undo stack** — `environment-panel.ts` mutates `state.world.environment` directly and only sets dirty flags.
5. **The brush silently creates terrain on flat worlds.** `src/tools/brush-tool.ts:66-68` assigns `defaultTerrain()` when `world.terrain` is null. Both shooter arenas have `terrain: null`; one stray B-keypress + click adds a 128×128 heightmap to a world that shouldn't have one, and the terrain creation itself is not undoable (only the stroke's height deltas are).

### 1.2b Corrections & additional bugs (second audit, 2026-07-11, Windows/Perry 0.5.1208)

Corrections to the audit above, verified against the actual files:

- `arena_02` has **1** water volume (id `river`, a box volume standing in for the river), not 6; `rivers[]` is empty.
- `enemy_spawner` entities carry only `userData.kind` — there are no `enemyType`/`waveBits`/`maxAlive`/`cooldown` keys (§1.5 overstates); the whole wave plan lives in `wave_config.userData.waves`. F1 stands, its acceptance example doesn't.
- `loadRecentProjects` is not dead code (called from `addRecentProject`); the missing piece is UI that reads the list.
- Autosave/Ctrl+S live in `main.ts`, not `world-io.ts`.

Additional bugs found (fixed in the same pass as B1-B4):

6. **Environment sky & fog edits were silent no-ops** — `syncEnvironment` never applied `skyColor`/`fogStart`/`fogEnd`. Fixed: clear color reads the world's sky each frame; fog maps to `setFog` with a density approximation.
7. **Directional light accumulated** — `addDirectionalLight` per env sync stacked lights. Fixed: `setDirectionalLight` re-applied every frame (begin_frame resets the lighting block anyway — same reason the shooter re-sets sun/ambient per frame).
8. **Water/river id counters reset per launch** → duplicate ids on reopened worlds made `AddWaterCommand.undo` remove the wrong volume. Fixed: counters persist in `world.metadata` (like `nextEntityId`) with a collision guard.
9. **Backspace deleted the selected entity** — latent footgun for text fields. Fixed: Delete only, and only while no widget is active.
10. **Entity with both modelRef and prefabRef double-bound and leaked a node.** Fixed: prefab branch takes precedence, single bind.
11. **Entity tints rendered near-black in the editor** — `sync.ts` passed 0-1 world tints straight into `setSceneNodeColor`, which expects 0-255 (see `applyTint` in the engine loader). Fixed.

✅ **Why the editor never started on Windows: it was written against an engine API that doesn't exist.** Three separate mismatches, each producing the same `TypeError: Expected number for native f64 parameter` on the first frame — an `undefined` reaching a native `f64` parameter:

1. **Key constants.** The editor used `Key.LeftControl` / `LeftSuper` / `Escape` / `Delete` / `Space` / `LeftShift` / `RightShift`; the engine (`engine/src/core/keys.ts`) spells them `LEFT_CONTROL`, `LEFT_SUPER`, `ESCAPE`, `DELETE`, `SPACE`, `LEFT_SHIFT`, `RIGHT_SHIFT`. Letters (`Key.Z`) were correct, which hid the pattern.
2. **Mouse buttons.** `MouseButton.Left/Right/Middle` → engine has `LEFT/RIGHT/MIDDLE`.
3. **`drawLine` arity.** `widgets.ts:separator()` called `drawLine(x1,y1,x2,y2, 1, color.r, color.g, color.b, color.a)`, but the engine signature is `(x1, y1, x2, y2, thickness, Color)` — so it read `.r` off the number `1` and got `undefined`. This one only fires on the first panel that draws a separator, which is why it surfaced last.

4. **`setSceneNodeTransform` / `updateSceneNodeGeometry` were unreachable from TypeScript.** Both take their arrays through `i64` pointer params, and Perry 0.5.x refuses to pass a `number[]` into an `i64` ("Expected safe integer for native i64 parameter"). The engine had already worked around this for meshes (the `bloom_mesh_scratch_*` buffers) but never migrated the scene-graph pair — the shooter uses `setSceneNodeTrs` (all-scalar) so nobody hit it, while the editor needs full matrices (non-uniform scale: a boundary wall is 40×4×0.5). **Fixed in the engine** (additive, nothing else changes): new `bloom_scene_set_transform16` (17 scalars, stateless) and `bloom_scene_update_geometry_scratch` (re-uses the mesh scratch); the TS wrappers now route through them, and the stale "prefer setSceneNodeTrs until the scratch migration lands" note in `engine/src/scene/index.ts` is now true history.

All fixed. Perry does not type-check missing members on these `const` objects, so none of this failed at compile time. **Perry's reported stack line was flat wrong** (it blamed `sync.ts:383` for a fault in `main.ts`'s input block) — trust `console.error` breadcrumbs, not the line attribution. An engine-API audit of the remaining call sites (`drawRay`/`drawCube`/`drawText`/scene calls) found no further mismatches.

⚠️ **Separately: Perry 0.5.1208 miscompiles `Map` fields on an interface** — a real bug, found while chasing the above, though it was *not* what broke the editor. Reading `.size` on a `Map` field of an interface access-violates once the program declares more than one such field; `Set.size` and class fields are fine. `AssetCatalog` and `HandleMap` are now classes as a precaution, and no code reads `Map.size` through a property chain. Full repro table + rules: **`docs/perry-map-size-av.md`** — read it before adding a `Map` to editor state, and report upstream.

Traps recorded so nobody re-pays for them: Perry's **stdout is block-buffered and lost on a native crash** (use `console.error`); a debug line printing `someMap.size` *introduces* an access violation of its own (the instrumentation became the bug for hours); and `loadAssetCatalog` takes ~20 s here for the shooter's 26 GLBs (the "&lt;1 s" comment in that file is macOS-calibrated) — the black window at startup is loading, not a hang. Async/lazy catalog loading deserves a follow-up.

### 1.3 Dead code — written but unreachable (all verified by grep: zero call sites)

| Code | What's missing to reach it |
|---|---|
| Prefab authoring mode — `src/tools/prefab-tool.ts` (~100 LOC: `enterNewPrefabMode`:16, `enterPrefabEditMode`:25, `savePrefabToDisk`, `addPrefabChild`) | No UI entry point ever calls it; `state.editingPrefab` can never become non-null. `main.ts` does call `updatePrefabTool`/`drawPrefabBreadcrumb`, which only ever see null. `ToolId` includes `'prefab'` (`src/state/editor-state.ts:14`) but nothing sets it. |
| Asset thumbnails — `src/ui/thumbnails.ts` (`renderAllThumbnails`, `getThumbnail`) | Never called; asset panel draws text-only rows. The file's comment worries render targets are stubs — **outdated**: `beginTextureMode`/`endTextureMode` are fully implemented (TS: `../engine/src/textures/index.ts:170`; Rust: `renderer/mod.rs:6450`). |
| Text-input widget — `src/ui/text-input.ts` (74 LOC, cursor/backspace/Enter/ESC) | No panel uses it (no rename fields anywhere). |
| Recent-projects read path — `src/io/recent.ts` `loadRecentProjects` | Write path runs on every launch (`main.ts:82`); nothing ever reads or displays the list. |
| Self-tests — `src/tests/self-tests.ts` `runSelfTests` | Header comment promises a `--test` CLI flag; `main.ts` has no argv handling at all. |
| Terrain paint — `'paint'` in `BrushSettings.kind` (`editor-state.ts:68`) + `activeLayerIdx` (`:72`) | No `'paint'` branch in `applyBrush` (`brush-tool.ts:121-150`), not listed in brush-panel's kind buttons, and nothing anywhere reads/writes `TerrainLayer` data. |

Minor: `label` is imported but unused in `brush-panel.ts` and `environment-panel.ts`; `endPanel` (`widgets.ts:48`) and `uiEndFrame` (`ui-context.ts:83`) are intentional no-op placeholders.

### 1.4 Engine shared world module (`../engine/src/world/`)

- **Format:** JSON, `WORLD_SCHEMA_VERSION = 1`. `WorldData` = `{ schemaVersion, name, id, bounds{min,max}, environment, terrain|null, entities[], water[], rivers[], metadata }`. Entities: `{ id, name, modelRef XOR prefabRef, transform(TRS, Euler radians), tint?, tags[], userData: Record<string,string> }`. Terrain: row-major heightmap grid (`width`,`depth`,`cellSize`,`origin`,`heights[]`) + `layers: TerrainLayer[]` (splat: `id`, `textureRef`, per-cell `weights[]`, `tileScale`). Water: axis-aligned boxes (`center`,`size`,`surfaceHeight`,`color` **0-1 floats**, `waveAmplitude`,`waveSpeed`). Rivers: Catmull-Rom splines (`controlPoints[]`, per-point `widths[]`, `depth`, `flowSpeed`, `color`). Prefabs: separate `*.prefab.json`, nestable, cycle-checked.
- **Load/save:** `loadWorld` (read → parse → migrate → validate, pure) and `instantiateWorld` (spawns scene nodes) are split. `saveWorld` validates before writing, pretty-printed JSON. `version.ts` is migration scaffolding with no real migrations yet (v1).
- **Gap:** `instantiateWorld` does **not** render water or rivers — it pushes warnings instead (`loader.ts:152-160`, "pending engine Q8 shader" / "pending Q9 spline ribbon"). Those comments are **stale**: the engine already ships everything needed — `setSceneNodeWaterMaterial` (`../engine/src/scene/index.ts:649`; ⚠ takes color **0-255 per channel**, divides by 255 internally — world-schema colors are 0-1, convert!), `genMeshSplineRibbon` (`../engine/src/models/index.ts:203`, real Rust impl behind the `models3d` feature), `bloom_gen_mesh_heightmap`, `bloom_physics_shape_heightfield`, and `bloom_compile_material` (custom material compiler).
- `terrain.ts` is pure TS: `buildHeightmapMesh` (12-float vertex stride `[x,y,z, nx,ny,nz, r,g,b,a, u,v]`), `sampleHeight`, `raycastTerrain`, `defaultTerrain`. No FFI calls of its own; the editor uploads via `updateSceneNodeGeometry`.
- **Consumers:** editor (34 imports), garden (runtime `loadWorld`/`instantiateWorld`), shooter (format only — see §1.5), jump (none).

### 1.5 Shooter world pipeline

- `assets/worlds/*.world.json` conform to the schema above and were authored with this editor (shooter's `editor.project.json`: `{ name, gameId, modelsDir: "assets/models", prefabsDir, worldsDir: "assets/worlds", defaultWorld: "arena_01.world.json" }`). `arena_02` ("Outdoor plaza", 32 KB) is the real level: 66 static meshes, 6 water volumes, plus the gameplay entities listed in §1.2(2).
- **Gameplay semantics live in `userData`**, discriminated by `userData.kind`: `player_spawn`, `collider_box` (`halfExtents`), `static_mesh` (optional `collider`), `point_light` (`range`,`color`,`intensity`), `enemy_spawner` (`enemyType`,`waveBits`,`maxAlive`,`cooldown`), `weapon_pickup` (`weapon`), `wave_config` (`waves` = escaped-JSON string), `box`. All values are strings.
- **Runtime path (CORRECTED 2026-07-15):** ~~shooter never calls `loadWorld`~~ — it does now. `tools/build-world.ts` and `src/generated/` have both been **DELETED**; `src/world-runtime.ts` reads `assets/worlds/*.world.json` at startup via `loadWorld`. The Perry 0.4.x bugs that forced the bake are fixed, exactly as §1.6 predicted, and the workaround went with them. **There is no rebake step for world data.** What IS still derived: the terrain's *visual mesh* (`bun tools/build-terrain.ts`) — sculpt, save, re-run that one command. Terrain PAINT needs no rebake (the splat uploads at load).
- Drawable geometry references GLBs converted offline from Unvanquished assets (`tools/convert-*.ts`, `docs/asset-pipeline.md`). The `_gizmo_box.glb` sentinel is not a file — the baker maps it to "draw a colored box".

### 1.6 Toolchain status (Perry 0.5.1239)

- **Both runtime bugs that forced shooter's bake workaround are FIXED** — verified 2026-07-11 with a compiled test program: `JSON.parse('[1,2,3]').length` → `3` (was `undefined` in 0.4.x); nested parsed arrays work; a function containing `throw new Error` runs, and try/catch catches. Runtime `loadWorld` is now viable everywhere.
- Native libraries need an allowlist: host `package.json` must declare `"perry": { "allow": { "nativeLibrary": ["bloom"] } }` (temporary escape: `PERRY_ALLOW_PERRY_FEATURES=1`). The editor's `package.json` doesn't have it yet (task A1).
- The engine's `package.json` lacks `perry.nativeLibrary.abiVersion` — a warning today, a **hard error from Perry 0.6** (task A2).

---

## Part 2 — Definition of done

The editor "works exactly as it should" when all of the following hold:

1. `perry compile src/main.ts` succeeds with no env-var escape hatch, from a clean checkout.
2. Opening `../shooter/editor.project.json` shows `arena_02` with **every** entity visible (placeholder boxes for sentinel/missing models), selectable, and editable — including `userData` key/values (e.g. change an `enemy_spawner`'s `cooldown` and save).
3. A world edited and saved by the editor is **semantically lossless**: load → save of an untouched world produces JSON equal to the original when parsed (key order aside), verified by an automated round-trip test on copies of both shooter arenas.
4. Water and rivers render properly (translucent animated-water material, ribbon meshes) in the editor **and** via `instantiateWorld` in games; they can be created with chosen parameters, selected, inspected, edited, moved, and deleted, all undoably.
5. Terrain supports sculpting **and** layer painting: layers with textures can be added, painted with the brush, rendered splat-blended in the editor and in `instantiateWorld`, and round-trip through the file format.
6. Prefab authoring works end-to-end: create a named prefab, add children, save to `*.prefab.json`, place instances, edit an existing prefab, nesting works, cycles rejected.
7. Inspector/outliner support rename, tint, tags, `userData`, and modelRef reassignment; the asset panel shows rendered thumbnails; recent projects are listed and openable at startup.
8. Every mutating operation goes through the undo stack — including environment edits, water/river edits, terrain-creation, paint strokes, and userData changes.
9. Ctrl+Y only redoes. No single-key tool hotkey fires while Ctrl/Cmd is held.
10. Self-tests are runnable from the shipped binary, extended to cover the new commands and the round-trip test, and pass.

---

## Part 3 — Work plan

Tasks are grouped, not phased — everything ships. Order within reason: **A → B → (C engine half) → everything else in parallel**; K last since it's the end-to-end proof. Verify-first items are flagged ⚠.

### A. Toolchain & hygiene

- **A1.** Add to `package.json`: `"perry": { "allow": { "nativeLibrary": ["bloom"] } }`. Acceptance: clean compile with no `PERRY_ALLOW_PERRY_FEATURES`.
- **A2.** Add `perry.nativeLibrary.abiVersion` to `../engine/package.json` (see Perry's `docs/native-libraries/manifest-v1.md` for the value). Acceptance: the ABI warning disappears from compiles.
- **A3.** `git init` + initial commit. Delete the stale April `bloom-editor` binary; gitignore `main`, `dist/`, `node_modules/`.
- **A4.** Make self-tests reachable: ⚠ first check whether Perry exposes argv (grep Perry's stdlib for `argv`/`args`); if yes implement the promised `--test` flag in `main.ts`, otherwise use an env var (e.g. `BLOOM_EDITOR_SELF_TEST=1`). Must run `runSelfTests` and exit non-zero on failure. Update the stale header comment in `self-tests.ts` to match reality.
- **A5.** Add a short `README.md`: what the project is, build command, how to open the shooter project, pointer to this plan.

### B. Correctness fixes

- **B1.** Gate the whole tool-hotkey block (`main.ts:139-146`) on `!isKeyDown(Key.LeftControl) && !isKeyDown(Key.LeftSuper)`. Acceptance: Ctrl+Y redoes without changing tool; T/Y still switch tools bare.
- **B2. Placeholder rendering for missing/sentinel models.** In `syncRebuilds` (`sync.ts:65-81`), when a modelRef has no loaded model (including `_gizmo_box.glb` and any future missing file), attach a unit cube (`genMeshCube`, scaled by entity transform) instead of skipping, colored by `entity.tint` if set, else by a stable per-`userData.kind` color map, else a "missing model" magenta. Bind the handle so picking works. Prefab leaves with missing models get the same treatment. Acceptance: opening `arena_02` shows all ~20 gameplay entities as colored, pickable boxes.
- **B3.** Make terrain creation explicit and undoable: replace the silent `defaultTerrain()` in `brush-tool.ts:66-68` with either (a) a "Create terrain" button in the brush panel issuing a `CreateTerrainCommand`, or (b) folding terrain creation into the stroke command's undo state so Ctrl+Z after a first-stroke removes the terrain entirely. Either way, `world.terrain` must return to `null` on undo.
- **B4.** Cache the prefab registry in `syncRebuilds` (currently rebuilt per entity per frame, `sync.ts:83-87`); invalidate on catalog changes. Remove the dead `label` imports.

### C. Water & rivers, end-to-end — ✅ DONE (2026-07-11)

Landed. Notes that differ from the plan as written:

- **`genMeshSplineRibbon` was also unreachable** from TypeScript — same i64-pointer problem as the scene transform (the plan assumed it was ready to use). Added `bloom_gen_mesh_spline_ribbon_scratch`; the wrapper now pushes points then widths through the mesh scratch.
- Shared helpers live in **`engine/src/world/render.ts`** (`spawnWaterVolume`, `spawnRiver`) and are called by both `instantiateWorld` and the editor's sync layer, so a river cannot look different in-game than in the editor. The 0-1 → 0-255 colour conversion happens there, once. The stale "pending Q8/Q9" warnings are gone.
- `InstantiateResult` reports `waterHandles` / `riverHandles` as **arrays, not Maps**, index-aligned with `world.water` / `world.rivers` — it already had one `Map`, and a second would have tripped the Perry interface-Map miscompile documented in `docs/perry-map-size-av.md`.
- Selection is now `{ primary, kind: 'entity' | 'water' | 'river' }`. Entity-only paths (gizmos, entity inspector, duplicate, frame-on-selection, outline) go through `selectedEntityId()`, which returns null for a water/river selection, so a selected river can never be handed to code that assumes `world.entities`.
- Outliner lists **Water and Rivers above Entities** — the panel does not scroll, and a world with 66 entities would otherwise bury them below the fold permanently.
- Delete removes the selected water/river (undo restores it at its original index, so ordering round-trips). Edits coalesce per drag like entity transforms.
- Creation defaults (`WATER_DEFAULTS`, `RIVER_DEFAULTS`) replace the previously hardcoded constants.

Still open from C: dragging a **gizmo** on a water volume (move/scale writes `center`/`size`) and per-control-point river handles. Both are editable numerically in the inspector today.

### C. Water & rivers, end-to-end (original plan)

- **C1. Engine: real spawning in `instantiateWorld`** (`../engine/src/world/loader.ts:152-160`). Create a shared helper module (e.g. `../engine/src/world/render.ts`) with `spawnWaterVolume(v)` — scene node + box mesh sized to `v.size` at `v.center` (top face at `surfaceHeight`), `setSceneNodeWaterMaterial` with `waveAmplitude`/`waveSpeed` and **color converted 0-1 → 0-255** — and `spawnRiver(r)` — sample the Catmull-Rom spline through `controlPoints` (interpolate per-point `widths`), feed `genMeshSplineRibbon`, offset down by `depth`, water material. Replace the two TODO warnings with actual spawns; return handles in the instantiate result. Delete the stale "Q8/Q9" comments. Acceptance: garden (or a test scene) instantiating a world with water/rivers shows them.
- **C2. Editor: render through the same helpers** in `sync.ts` (new `syncWater`/`syncRivers` driven by pending-flags, mirroring entities), replacing the water tool's translucent debug cubes and the river tool's debug lines. Keep an editor-only selected-highlight overlay.
- **C3. Selection model generalization.** Extend selection (currently entity-id-only) to `{ kind: 'entity'|'water'|'river', id }`. Register water/river scene nodes in the picking map; list them in outliner sections; support delete (new `RemoveWaterCommand`/`RemoveRiverCommand`), and move (gizmo translates `water.center` / river control points; render draggable point handles for a selected river; scale gizmo edits `water.size`). All undoable.
- **C4. Inspector sections**: water (`surfaceHeight`, color, `waveAmplitude`, `waveSpeed`) and river (`depth`, `flowSpeed`, color, per-point width), editable, undoable (coalesced drag commands like `TransformEntityCommand`).
- **C5. Toolbar buttons** for water and river next to the existing four (`toolbar.ts:46-51`), plus creation-defaults fields (e.g. in the brush-panel pattern) so new volumes/splines aren't hardcoded.

### Schema v2 — first-class point lights — ✅ DONE (2026-07-11)

Not in the original plan; added because the editor could not light its own preview.

In v1, a light was an *entity* carrying `userData.kind = "point_light"` plus `range` / `color` / `intensity` strings — a private convention between one game and its baker. The editor saw an entity with no model (an invisible, unlit marker), and every new game would have re-invented the same convention. Sun, ambient, and fog were already first-class in `environment`; point lights now sit beside them in a top-level `lights: LightData[]`.

The dividing line, for future schema questions: **lights are engine-universal — every renderer knows what a point light is — so they are schema. A spawner or a wave plan means nothing without the game, so it stays `userData`.** The editor stays game-agnostic either way.

- `WORLD_SCHEMA_VERSION = 2`; `migrateWorldData` lifts v1 `point_light` entities into `world.lights` on load, so old worlds keep working untouched. Covered by self-tests (id/position/colour/range/intensity carried over, non-light entities untouched, v2 worlds left alone, result validates).
- `applyWorldLights(world)` in `world/render.ts` must be called **every frame** — the renderer clears its lighting block in `begin_frame`, the same reason games re-apply sun and ambient. Calling it once at load lights the world for exactly one frame.
- Editor: Light tool (click to place), Lights section in the outliner, inspector (position / colour / intensity / range), delete with index-preserving undo, and a wire marker at each light plus a range sphere when selected — a light has no mesh, so without markers you cannot see or click one.
- Shooter: `arena_02` migrated to v2 (5 lights lifted out of `entities`); its baker reads `world.lights` and still falls back to the v1 entity form. **The generated runtime data is byte-identical apart from one comment** — the migration is semantically a no-op for the game.

### D. Terrain paint & layers — ✅ DONE (2026-07-13)

> Paint the ground. The layer list lives in the brush panel; layers are the world's
> own `terrain.layers`, and the swatch beside each is the **mask colour** the
> viewport tints it with — the viewport shows you *coverage*, the game shows you the
> material.
>
> - **D1 UI** — `+ Add layer` picks a texture from the project's textures dir (new
>   `texturesDir` key, default `assets/textures`; the catalog lists them without
>   loading them — a splat layer only ever stores a path). Select the active layer,
>   delete a layer, `paint` is a fifth brush kind.
> - **D2 Kernel** — `paintCell` in `brush-tool.ts`. LMB paints, **Shift+LMB erases**.
>   A splat is a *partition*: painting grass in must push everything else out, or the
>   weights sum past 1 and a cell that is 90% grass AND 90% rock renders as a washed-out
>   average of every texture at once. Erase drives the active layer to zero and does NOT
>   push the others up, so coverage falls and the ground fades back to the game's
>   procedural blend rather than to a bald patch. Undo snapshots **every** layer, not
>   just the one you were holding.
> - **D3 Rendering** — no new material system was needed. The shooter already had a
>   4-layer triplanar splat shader whose weights were computed procedurally (slope,
>   moisture noise, distance to the river) and authored *nowhere*. The painted weights
>   now arrive as one RGBA8 texel per terrain cell and are mixed **over** that
>   procedural blend by coverage. So a cell nobody painted keeps the procedural look
>   exactly — which is why turning this on changed neither shipped arena by a pixel.
>
> Transport needed one engine addition: **EN-049 `createTextureArrayFromTexels`**. The
> existing byte-array FFI takes a raw pointer, and Perry cannot pass an array to one
> ("Expected safe integer for native i64 parameter") — so it was uncallable, and every
> caller had ended up on `createTextureArrayFromFiles`, which is right for art and
> useless for data computed at load.
>
> **Verified end-to-end in the game**, not just in the editor: `tools/paint-test-world.ts`
> writes the same data the brush does, and the shooter renders it. Editor preview is the
> heightmap mesh's vertex colour (`buildHeightmapMesh` blends the mask palette by weight).
>
> Cost along the way: **EN-050** — Perry miscompiled the engine's `clamp`, so every splat
> weight quantised to `0` and painted terrain loaded unpainted. See shooter
> `docs/perry-quirks.md` #8; it is pinned by the `testSplatPaintPartition` self-test.

### Play-in-editor — ✅ DONE (2026-07-12)

> A **Play** button in the toolbar (and Ctrl+R): saves the level currently on screen
> — not the one on disk — to a scratch world, and launches the real game on it
> (`--world <path>`, new in the shooter). The fly-cam shows you geometry; only the
> game shows you whether the spawners spawn and whether the arena has a shape.
>
> Needed two engine additions: **EN-048 `launchProcess`** (Perry's
> `child_process.spawn` compiles and then does nothing — undefined pid, no process),
> and the shooter's `--world` override. `playCommand` in `editor.project.json` opts a
> project in; no key, no button.

### E. Prefab authoring — ✅ DONE (2026-07-12)

> **Shipped.** `prefab-tool.ts` had existed for weeks with **zero call sites**,
> because the UI it appeared to need — a parallel render path for children, a
> parallel selection model, parallel gizmo handling — was too big a job to start.
>
> **It didn't need any of that.** A `PrefabChild` is an `EntityData` minus `name`
> and `userData`, so while you are editing a prefab its children simply **ARE**
> `state.world.entities`: the real world is parked in a stash and the children are
> handed to the editor as if they were the world. Rendering, picking, the gizmos,
> delete, duplicate, snapping, undo/redo — every one of those was already written
> against entities, and not one of them needs to know it is looking at a prefab.
>
> - **E1/E2 (UI):** name field + `+ New Prefab` in the Prefabs tab; `Edit "<name>"`
>   for the selected prefab. No double-click — the UI context has no notion of one,
>   and inventing a hidden gesture is worse than a visible button.
> - **E3:** placement uses the ordinary `CreateEntityCommand`. Ctrl+S saves the
>   *prefab* (not the world — that would write the neutral authoring stage over the
>   real level). ESC exits and restores the world **and its undo history** exactly.
> - **E4:** the catalog refreshes on save, so a new prefab is immediately placeable.
> - **Cycle rejection** is transitive (A→B→C→A), refused at the one place a cycle can
>   be created — the place tool — and it now *says so*, via a new transient status
>   line. A click that silently does nothing reads as a broken editor, not as a rule.
> - 6 new self-tests (mode round-trip incl. history restore; direct, one-hop and
>   multi-hop cycles).

### E. Prefab authoring — original plan

- **E1.** "New Prefab" button in the asset panel's prefab tab → prompt for a name using the `textInput` widget (`src/ui/text-input.ts`) → `enterNewPrefabMode`.
- **E2.** Double-click a prefab entry → `enterPrefabEditMode`.
- **E3.** While `state.editingPrefab` is set: place tool routes additions through `addPrefabChild` instead of `CreateEntityCommand`; select/gizmos operate on children; a Save button (and Ctrl+S) calls `savePrefabToDisk`; ESC exits (already wired).
- **E4.** After save, refresh the asset catalog so the new prefab is immediately placeable, and regenerate its thumbnail (G).
- Acceptance: author a 2+ model prefab, save, place 3 instances, reload the world — instances expand correctly; edit the prefab and confirm instances update on reload; a self-test covers cycle rejection.

### F. Inspector & outliner depth

- **F1. `userData` editor (highest-value item for shooter).** Inspector section listing key/value rows with `textInput` editing, add-row, delete-row. Game-agnostic (free-form strings). Undoable (`SetUserDataCommand`). Acceptance **(corrected 2026-07-15 — the baker is gone):** change an `enemy_spawner`'s `cooldown` in `arena_02`, save, and launch the shooter — the value is live, with no rebake.
- **F2.** Entity rename (textInput), tint editing (vec4 field or color widget), tags add/remove, modelRef reassignment via an asset-picker popup. All undoable.
- **F3.** Outliner: double-click rename, per-row delete/duplicate, a filter/search box, and sections for entities / water / rivers (per C3). True hierarchy is out of scope (the format has no parenting).

### G. Asset thumbnails

Wire `renderAllThumbnails` (`src/ui/thumbnails.ts`) after catalog load; asset panel becomes a thumbnail grid with name labels; regenerate thumbnails when prefabs are saved. Render targets are confirmed working (§1.3) — update the stale comment at `thumbnails.ts:10`. Acceptance: model and prefab tabs show rendered images.

### H. Recent projects

On startup with no project (or via a toolbar "Open Recent"): show entries from `loadRecentProjects` (`src/io/recent.ts` — read path already implemented) and open the selected one. Acceptance: second launch offers the shooter project with one click.

### I. Environment panel completeness

Add the missing schema fields — `sunColor`, `ambientColor`, `fogColor` — and route all env edits through a coalescing `SetEnvironmentCommand` so they undo (fixes §1.2(4)). Acceptance: tweak fog color, Ctrl+Z restores it.

### J. Playtest (small)

Keep fly-cam as the core mode (matches original scope). Stretch, only if trivial after C/D land: a gravity-walk toggle using `sampleHeight` ground clamping. Not required for done.

### K. Shooter round-trip & integration proof

- **K1. Automated lossless round-trip test:** ✅ **DONE (2026-07-15 evening).**
  Fixture copies of both arenas live in `src/tests/fixtures/`;
  `testWorldFileRoundTrip` runs `loadWorld` → `saveWorld` → parse both → structural
  deep-compare with dotted-path diff reporting (`deepJsonEqual`), and passes for
  both — the saver is semantically lossless on real worlds, including arena_02's
  terrain + splat layers. The synthetic `JSON.stringify` test described below is
  **deleted**, replaced by the real thing. A companion `testPrefabFileRoundTrip`
  pins the prefab saver (see Part 4 §P1 — it was NOT lossless until today).
  Original flag, kept for history: ⚠️ **the
  test that existed was actively MISLEADING (flagged 2026-07-15).**
  `testWorldRoundTrip` in `src/tests/self-tests.ts` round-trips a *synthetic*
  2-entity world with `JSON.stringify` — it never calls `saveWorld`, and
  `JSON.stringify` is the very idiom quirk #6 says corrupts a parsed graph (the
  bug that made `saveWorld` write 0 bytes and report success). It passes by
  construction and covers nothing. A green tick sitting over the exact hole is
  worse than no test. The real work, unchanged: copy both arena JSONs into `src/tests/fixtures/` (or read them from `../shooter` if self-tests can take a path); self-test loads each, saves to a temp path, deep-compares parsed JSON. Must be exact for untouched worlds — any normalization the saver applies is a bug to fix, not a tolerance to add.
- **K2. Bake hook:** ⚠ **RESCOPED 2026-07-15 — the original premise is void.** It targeted `bun tools/build-world.ts`, a baker that **no longer exists**: the shooter loads world JSON at runtime, so editing a world needs **no rebake at all** and there is nothing to hook for it. Process spawning was also settled meanwhile (Perry's spawn is a no-op; the engine's `launchProcess` works, and play-in-editor already uses it). What survives is much smaller: the terrain **visual mesh** is still derived (`bun tools/build-terrain.ts`), so a `postSaveCommand` would be worth it *only* for a world whose heightmap changed. Everything else — entities, lights, water, rivers, and terrain paint — is live on the next launch with no command.
- **K3. Companion note (shooter repo, optional, not this codebase):** with the Perry bugs fixed (§1.6), shooter can migrate to runtime `loadWorld` + `instantiateWorld` like garden and delete the baker — or keep baking for startup performance. Decision belongs to shooter; the editor only owes lossless files + the hook above.
- **Final acceptance walkthrough:** open shooter project → arena_02 fully visible/editable → move a pickup, edit a spawner's userData, add a water volume, save → round-trip test green → rebake → shooter runs with the changes.

### Open questions to resolve early (all flagged ⚠ above)

1. Does Perry expose argv? (A4)
2. Does `bloom_compile_material` support texture bindings, or does splat rendering need a new engine FFI? (D3 — the only genuinely unknown-size task in this plan)
3. Does Perry/Bloom expose process spawning for the bake hook? (K2)

### Verification expectations

Every task lands with its self-test where the logic is testable headless (commands, round-trip, paint kernel, selection model), and the implementer should run the editor against the shooter project after each group — the acceptance criteria above are written to be executed, not assumed.

---

## Part 4 — Any world, any game (added 2026-07-15)

**Goal:** this editor edits any world for any game that uses the world format. Parts 1–3 made it a working editor for the shooter's worlds; Part 4 is what separates that from a general tool. Audited 2026-07-15 (editor source, engine world module, and all four game repos); plan follows.

### 4.1 Audit — where the "any game" claim actually stands

**The editor is already game-agnostic in behavior.** A full sweep found no hard game dependency: game semantics stay opaque in `userData`/`tags`/`metadata`, the editor never injects or interprets shooter vocabulary for behavior, and every `editor.project.json` key is optional. What remains is soft coupling:

- `KIND_COLORS` / `MESH_TAG_COLORS` (`src/world-sync/sync.ts:93-108`) hardcode shooter kind names for placeholder-cube colors. Unknown kinds fall through to a stable hash-hue, so nothing breaks — but the curated map should come from project config.
- `userData['halfExtents']` (`sync.ts:144-154`) sizes placeholder cubes — a convention, not a contract; other games get unit cubes.
- Play-in-editor requires the game to accept `--world <path>` (`src/playtest/launch.ts:47-48`). Reasonable, but written down nowhere.
- No-project mode works (bare `.world.json` opens, edits, saves) but renders every model-backed entity as a magenta cube — the catalog is empty without a project.
- `gameId` is parsed from the project file and silently discarded (`src/io/project.ts:33`).
- Asset catalog startup is fully synchronous (`src/io/asset-catalog.ts:55-76`) — ~20 s black window on the shooter's 26 GLBs; scales with the game.

**The ecosystem is where the claim fails today.** Shooter is the world format's *only* consumer — and it spawns via its own flat-array code (`shooter/src/world-runtime.ts`), so **`instantiateWorld` still has zero game consumers** and the whole generic render path (§C's "a river cannot look different in-game" guarantee) remains unproven outside the editor. Garden ignores the format entirely (hardcoded single-file scene — two `drawCube` calls and 12 constant-array collectibles). Jump is 2D with its own text format and own editor; structurally out of scope. No engine example loads a world. "Any game that uses the world format" currently describes a set of one, whose loader was co-designed with this editor.

**Two file-trust defects found (both FIXED same day, see §P1):**

1. **Prefab round-trip was not lossless.** `serializePrefab` (`engine/src/world/serialize.ts`) wrote only `id`/`name`/`children` — `schemaVersion` was dropped and silently backfilled by migration on reload (hiding the loss), and `bounds` was dropped outright, coming back `undefined`. `createEmptyPrefab` also stamped `schemaVersion: 1` on a v2 schema.
2. **Unknown fields are silently stripped on save.** Validation tolerates unknown fields (correctly — forward compat) but the schema-explicit saver drops them, so a game's extension field survives load and vanishes on the first Ctrl+S with no warning anywhere. For a tool that claims to edit other games' data, silent data loss is the worst failure mode. (Preserving arbitrary unknown fields through the literal-key serializer is not realistic under Perry — see serialize.ts's header — so the honest contract is *detect and warn loudly*, plus sanctioned extension points that DO round-trip: `world.metadata`, `entity.userData`, `entity.tags`.)

### 4.2 Definition of done — "any game"

1. Both shooter arenas round-trip semantically losslessly under an automated test that runs the REAL save path. *(done — §P1)*
2. Prefabs round-trip losslessly, including `schemaVersion` and `bounds`. *(done — §P1)*
3. A file containing fields this editor doesn't know produces a loud warning at load — console and status bar — naming the fields, before the user can save. *(done — §P1)*
4. A written contract exists (engine repo) that a third game can implement without reading shooter source: world schema + extension points, `editor.project.json` keys, `--world` convention, `userData.kind` discrimination pattern.
5. `instantiateWorld` has at least one consumer that renders a world outside the editor (engine `world-viewer` example), and one real game consumer (garden).
6. A world authored **from scratch in the editor** plays in a game that is not the shooter.
7. The editor opens: a bare world with no project file, a project with unknown `userData` vocabularies, and a 500-entity world — without data loss and without the UI becoming unusable (outliner must scroll/filter).

### 4.3 Work plan

#### P1. File trust — ✅ DONE (2026-07-15 evening)

> The editor's core promise to another game is "I will not damage your data."
>
> - **P1a** Real world round-trip test (was K1): fixtures + `loadWorld` → `saveWorld` → parse → `deepJsonEqual` (dotted-path diffs, both directions of key diff). Both arenas pass. The synthetic `JSON.stringify` test is deleted.
> - **P1b** Prefab round-trip fixed in the engine: `serializePrefab` now writes `schemaVersion` + `bounds`; `migratePrefabData` backfills degenerate bounds for pre-fix files; `createEmptyPrefab` stamps the current version. Pinned by `testPrefabFileRoundTrip`.
> - **P1c** Unknown-field policy implemented: `listUnknownWorldFields` / `listUnknownPrefabFields` (`engine/src/world/validate.ts`) walk every schema level and return dotted paths. `loadWorld`/`loadPrefab` `console.error` each one (stderr survives crashes; stdout doesn't); the editor's `openWorld` additionally posts a status-bar warning naming the count and first offender BEFORE the user can save. Extension points that do round-trip are documented at the checker. Pinned by `testUnknownFieldDetection` (clean world lists nothing — false positives would spam every load).
>
> 129 self-tests pass via `./main --test`.

#### P2. The contract — write down what "uses the world format" means

✅ **DONE (2026-07-16):**

> - **P2a** `engine/docs/world-format.md` shipped: schema summary with
>   `types.ts` as source of truth, the three round-tripping extension points
>   and the strip-warning behavior, the full `editor.project.json` key table
>   (now nine keys — `kindColors` added), the `--world` play contract, both
>   runtime consumption shapes, and the versioning promises.
> - **P2b** `kindColors` project key feeds the placeholder map (hash fallback
>   stays); `gameId` is read and shown in the window title instead of being
>   parsed-and-dropped.
> - **P2c** `--project <path>` / `--world <path>` CLI args work — including a
>   bare world with no project. Discovered en route: the editor could not
>   START from any directory not carrying `dxcompiler.dll`/`dxil.dll` (Dx12
>   backend unavailable → Vulkan surface panic at window creation). The DLLs
>   now sit beside the exe (gitignored; README documents the one-time copy).

#### P3. The proof — a second consumer (P3a ✅, P3b open)

- **P3a** ✅ **DONE (2026-07-16).** `engine/examples/world-viewer/` runs arena_02: `loadWorld` → `instantiateWorld` → `applyWorldEnvironment` per frame, fly camera, instantiation warnings surfaced. `instantiateWorld` has its first consumer. The predicted gap was REAL: nothing on the generic path re-applied the environment per frame (the renderer clears lighting in begin_frame, so `instantiateWorld` alone lights exactly one frame). Fix: new shared `applyWorldEnvironment` in `engine/src/world/render.ts`, used by the viewer AND by the editor's `syncEnvironment` — the lighting preview is now literally the same code path everywhere. Also found en route: `getRenderTextureTexture` still returned the pre-0.5 `{ id }` Texture shape (fixed; it had zero draw-call consumers until thumbnails).
- **P3b** Port **garden** to the world format. Its scene maps directly (island → terrain or flat entities, water plane → water volume, 12 collectibles → entities with `userData.kind: "bloom"`), and it exercises the exact path shooter doesn't: a world **authored from scratch in the editor**, loaded via **`instantiateWorld`**. Acceptance: a garden level built in the editor plays in garden. Decision needed first: adoption as product direction vs. testbed branch — garden has a GDD; don't fight its design (§4.4 Q1).

#### P4. Generic editing depth — ✅ DONE (2026-07-16)

> All landed on `feat/editor-completion`: outliner scroll region + filter box
> (F3; rename lives in the inspector; per-row delete/duplicate stayed as the
> selection + Delete / Ctrl+D paths — a visible convention beats per-row
> button clutter in a 24px row); inspector rename / tint / tags / modelRef
> draft-and-Apply (F2, all undoable, add/remove tint discrete while drags
> coalesce); full-schema environment panel through a per-field-coalescing
> `SetEnvironmentCommand` (I); point gizmo for water center/size, river
> control points (click a handle, drag axes), and light position (§C tail);
> recent-projects panel with whole-project switching (H). **J** stays stretch.

#### P5. Polish — ✅ DONE except prefab thumbnails (2026-07-16)

> The catalog streams: `loadAssetCatalog` lists instantly, `pumpAssetCatalog`
> loads one GLB per frame in the main loop, entities pop from placeholder box
> to mesh as their model arrives. The ~20 s black window is gone. Model
> thumbnails (G) render one per frame into 128px render textures after the
> stream settles; the Models tab is a thumbnail grid. **Remaining sliver:**
> the Prefabs tab still shows text rows — prefab thumbnails need leaf
> expansion + a computed AABB (prefab `bounds` are typically degenerate).
> ⚠ Thumbnail visual quality is machine-verified only as "doesn't crash" —
> eyeball composition/orientation on first human run.

### 4.4 Open questions

1. Garden adoption: product direction or testbed? (P3b blocks on this; P3a doesn't.)
2. Should unknown-field warnings eventually harden into a versioned-strict mode (error, not warning, when `schemaVersion` claims current)? Today: warn only.
3. Does `world-viewer` belong in `engine/examples/` (sibling to `perry-embed`) or as a `--view` mode of the editor binary? Leaning examples/ — the point is proving the path with zero editor code in the loop.

---

## Part 5 — Production readiness (added 2026-07-17)

Parts 1–4 are feature-complete, and then two days of REAL USE found four
"done"-but-broken things in a row: mouse hits off by the display scale (DPI),
the editor unable to even start outside a directory carrying dxcompiler.dll,
the whole arena invisible under `--project` (catalog key identity), and an
0xc0000005 on the first placement click (Perry miscompiled the ray math into a
load from absolute address 8 — layout-sensitive, invisible to every test that
never clicked). The lesson is structural: **the features exist; what's missing
for production is the machinery that catches this class of failure before a
user does.** In rough priority:

### 5.1 Interaction smoke test — ✅ DONE (2026-07-17)

> `tools/ui-smoke.ps1`: launches the real binary against a scratch copy of
> the arena_01 fixture, injects asset-cell click → 5 placements → camera
> orbit → select → move-gizmo drag → Ctrl+S, then asserts alive, no FATAL on
> stderr, saved file parses, entity count grew by exactly the placements,
> and the safe-save siblings exist. First run: PASS (8 → 13 entities).
> Would have caught both the key-identity bug and the ray miscompile.
> Run it after every build and every Perry upgrade. Still to do: pin the
> Perry version formally; file the kept repro pair upstream.

### 5.2 Data safety — ✅ DONE (2026-07-17)

> - **Crash-safe saves** (engine `feat/safe-saves`): `saveWorld`/`savePrefab`
>   write `.tmp` → read back + byte-compare (catches the 0-byte-write class)
>   → snapshot `.bak` → write real. True atomic replace still wants a rename
>   FFI. Gitignore `*.world.json.tmp/.bak` in game repos.
> - **Exit recovery instead of confirm-on-close**: closing with unsaved
>   changes parks them in `<world>.recover` (never silently lost, never
>   silently overwriting); opening that world later announces the recovery
>   file in the status bar + console.

### 5.3 Engine features the editor is blocked on

- ~~**Render-mesh-to-texture**~~ ✅ **DONE (2026-07-17, engine#121 + this
  repo).** Root cause found in the engine: `begin_texture_mode`'s override
  was only consulted by the simple 2D `end_frame` — `end_frame_with_scene`
  (every 3D app) acquired and presented the surface unconditionally, so
  render-to-texture had silently no-oped for 3D content since Q1. The
  deferred path now routes its final passes into the RT and skips present.
  The editor's dedicated-frame thumbnail burst (world hidden, one model per
  frame, studio lighting) is live: the Models tab shows REAL rendered
  thumbnails, screenshot-verified — the first successful RT sampling in the
  engine. ~~Residuals~~ closed 2026-07-17 evening: **prefab-tab thumbnails**
  render too (leaves expanded, combined AABB framed, per-leaf
  drawModelTransform with tints; regenerated on prefab save;
  screenshot-verified with a 4-prop prefab), and the **RT override is
  pinned by a live-GPU regression test** (engine#123 —
  `deferred_frame_writes_render_target_override` runs a headless deferred
  frame, which pre-#121 could not render at all, and reads the clear back
  out of the texture). Remaining quirk: clicks landing during the ~0.5 s
  post-load thumbnail burst are dropped (frames are consumed whole).
- **Text-input completeness**: ~~caret movement~~ ~~clipboard paste~~
  ~~hold-to-repeat~~ DONE 2026-07-17 — Ctrl+V pastes at the caret, Ctrl+C
  copies the field, arrows/Delete auto-repeat via the new `isKeyRepeated`
  edge (its own FFI, so `isKeyPressed` stays initial-press-only for games).
  The Windows clipboard FFI was a STUB, as were the file dialogs (Open/Save
  buttons silently did nothing on Windows!) and `setWindowTitle` — all real
  now. ~~Remaining sliver: selection ranges~~ DONE 2026-07-17 evening:
  Shift+arrows/Home/End select, Ctrl+A/C/X/V act on the selection, typing
  and Backspace/Delete replace it, highlight rendered under the text.
- ~~**unloadModel**~~ DONE 2026-07-17: the FFI existed with no TS wrapper, so
  nothing could ever call it; wrapper added, and project switching now
  unloads the previous catalog's models.
- (Nice-to-have) UI scissor/clip rects — current clipping skips whole
  widgets; real clip rects would allow partially visible rows.

### 5.4 Editing depth that daily use will demand

Multi-select that acts as a group (selection.ids exists; gizmos/inspector act
on primary only), copy/paste, a per-point river width UI, terrain resize,
per-row outliner ops, world switcher listing `worldsDir` (Open dialog is the
only path today), and a persistent log panel (status line is a 4-second
transient — save errors deserve better). ~~Camera zoom~~ FIXED 2026-07-17:
the wheel now dollies toward the point under the CURSOR (not the world
center), honors multi-notch deltas, min distance 0.2, and no longer fires
while the pointer is over a scrolling panel. Middle-drag pans, right-drag
orbits — that was already there, just undocumented.

### 5.5 Proof obligations that remain from Part 4

The garden port (P3b, blocked on §4.4 Q1) is still the only thing that turns
"any game CAN use this" into "a second game DOES." macOS is untested since the
Windows bring-up — "production" means both platforms run the smoke test. And
scale is unmeasured beyond ~250 entities: syncRebuilds does O(n) find() per
rebuilt id and the outliner draws every row each frame; fine at hundreds,
unknown at ten thousand.
