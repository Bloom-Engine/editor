# Bloom World Editor — Audit & Completion Plan

**Date:** 2026-07-11 · **Toolchain:** Perry 0.5.1239 · **Status:** audit verified against source; plan not yet started.

This document is self-contained: it is written for an implementer with no prior context. It replaces the original design plan (which was deleted). Part 1 is a verified audit of the current state, Part 2 defines "done", Part 3 is the work plan. This is a **single unified scope** — do not cut it down to an MVP; if a task has a prerequisite, the prerequisite is in scope too.

---

## Part 0 — Orientation

**What this is:** an open-world editor for the Bloom engine. It authors `*.world.json` / `*.prefab.json` files (schema defined in the engine's shared world module) that Bloom games load. The primary compatibility target is the shooter's worlds — the editor must open, edit, and losslessly re-save `../shooter/assets/worlds/arena_01.world.json` and `arena_02.world.json`.

**Ecosystem paths** (siblings of this repo):

| Path | What |
|---|---|
| `../engine/` | Bloom engine: TypeScript API over a Rust/wgpu native library (412 FFI functions listed in `../engine/package.json` under `perry.nativeLibrary.functions`). Shared world module at `../engine/src/world/`. |
| `../shooter/` | Arena FPS. Worlds in `assets/worlds/`, editor project file `editor.project.json` at its root. Its `docs/perry-quirks.md` documents historical Perry bugs (now fixed — see §1.6). |
| `../garden/` | 3D collectathon; the only game using the runtime `loadWorld`/`instantiateWorld` path. |
| Perry (installed as `perry` on PATH; source checkout is a sibling of the `bloom/` tree) | The TypeScript→native AOT compiler that builds everything here. |

**Build & run:**

```sh
cd editor
PERRY_ALLOW_PERRY_FEATURES=1 perry compile src/main.ts   # until task A1 lands
./main
```

Perry 0.5 notes: the CLI is `perry compile <entry>` (there is no `perry build`); it emits `./main` and ignores `perry.toml`'s `out_dir`. Duplicate-symbol `ld` warnings (perry_stdlib vs libbloom_macos both embedding Rust std) are benign — the editor compiles and links clean as of 0.5.1239. The stale `bloom-editor` binary from April 2026 predates all of this.

This directory is **not a git repository** and has no history. Recommended first action: `git init` and commit the current state before changing anything.

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
- **Runtime path:** shooter never calls `loadWorld`. `tools/build-world.ts` (a bun script) bakes a world JSON into flat `export const` arrays at `src/generated/world.ts`, which `src/main.ts` imports. This was a workaround for two Perry 0.4.x runtime bugs (see §1.6 — both now fixed). Editing a world therefore requires a rebake: `bun tools/build-world.ts assets/worlds/arena_02.world.json src/generated/world.ts`.
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

### D. Terrain paint & layers

- **D1. UI:** layer list in the brush panel — add/remove `TerrainLayer` (pick `textureRef` via the asset catalog; ⚠ the catalog currently only scans models/prefabs — extend it to a textures dir, adding a `texturesDir` key to `editor.project.json` with a sensible default), set `tileScale`, select active layer (`state.brush.activeLayerIdx` already exists), and expose the `'paint'` kind button (`brush-panel.ts:22`).
- **D2. Kernel:** implement the `'paint'` branch in `applyBrush` (`brush-tool.ts:121-150`): add weight to the active layer's per-cell `weights[]` with the same radial falloff as sculpt kernels, renormalizing across layers per cell. Undo via a weights-snapshot command (mirror `TerrainStrokeCommand`).
- **D3. Splat rendering.** ⚠ Investigate `bloom_compile_material` (`../engine/native/.../ffi_core/models.rs`, TS wrapper in the engine) — determine whether compiled materials support texture bindings. Target design: pack up to 4 layer weights into an RGBA weights texture regenerated on paint, sample each layer's texture by terrain UV × `tileScale`, blend by weights. Implement in the engine (shared by editor and `instantiateWorld`). If `compile_material` cannot bind textures, the required engine extension (a material-with-texture-slots FFI) is **in scope** — enumerate and build it rather than shipping a vertex-color approximation. Acceptance: paint two layers in the editor, save, load in a game via `instantiateWorld`, blended texturing visible in both.

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

- **F1. `userData` editor (highest-value item for shooter).** Inspector section listing key/value rows with `textInput` editing, add-row, delete-row. Game-agnostic (free-form strings). Undoable (`SetUserDataCommand`). Acceptance: change an `enemy_spawner`'s `cooldown` in `arena_02`, save, run shooter's `bun tools/build-world.ts`, confirm the value lands in `src/generated/world.ts`.
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

- **K1. Automated lossless round-trip test:** copy both arena JSONs into `src/tests/fixtures/` (or read them from `../shooter` if self-tests can take a path); self-test loads each, saves to a temp path, deep-compares parsed JSON. Must be exact for untouched worlds — any normalization the saver applies is a bug to fix, not a tolerance to add.
- **K2. Bake hook:** ⚠ check whether Perry/Bloom exposes process spawning. If yes: support an optional `postSaveCommand` in `editor.project.json` (shooter would set `bun tools/build-world.ts {world} src/generated/world.ts`) and run it after save, surfacing failures in the status bar. If no: add a status-bar reminder ("world saved — rebake required for shooter") driven by presence of the key, and document the manual command in README.
- **K3. Companion note (shooter repo, optional, not this codebase):** with the Perry bugs fixed (§1.6), shooter can migrate to runtime `loadWorld` + `instantiateWorld` like garden and delete the baker — or keep baking for startup performance. Decision belongs to shooter; the editor only owes lossless files + the hook above.
- **Final acceptance walkthrough:** open shooter project → arena_02 fully visible/editable → move a pickup, edit a spawner's userData, add a water volume, save → round-trip test green → rebake → shooter runs with the changes.

### Open questions to resolve early (all flagged ⚠ above)

1. Does Perry expose argv? (A4)
2. Does `bloom_compile_material` support texture bindings, or does splat rendering need a new engine FFI? (D3 — the only genuinely unknown-size task in this plan)
3. Does Perry/Bloom expose process spawning for the bake hook? (K2)

### Verification expectations

Every task lands with its self-test where the logic is testable headless (commands, round-trip, paint kernel, selection model), and the implementer should run the editor against the shooter project after each group — the acceptance criteria above are written to be executed, not assumed.
