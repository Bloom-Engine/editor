# Bloom World Editor

An open-world editor for the [Bloom engine](https://github.com/Bloom-Engine/engine) — place entities, sculpt terrain, lay out water volumes and rivers, tune lighting and fog, and walk through the result, all in one native tool. Worlds are saved as plain-JSON `*.world.json` files (the engine's shared world format) and load directly into Bloom games such as [shooter](https://github.com/Bloom-Engine/shooter) and [garden](https://github.com/Bloom-Engine/garden).

Like everything in the Bloom ecosystem, the editor is written in TypeScript and compiled ahead-of-time to a native binary by [Perry](https://github.com/andrewtdiz/perry) — no browser, no Electron, no Node at runtime.

## Status

Feature-complete against **[`PLAN.md`](PLAN.md)**'s definition of done (the plan retains the full audit trail): entity placement/selection/duplication, move/rotate/scale gizmos, terrain sculpting **and** splat painting, water volumes and rivers (placeable, selectable, gizmo-draggable — including per-control-point river handles), point lights, prefab authoring with cycle rejection, rename/tint/tags/modelRef editing, free-form `userData` editing, a full environment panel, asset thumbnails, recent projects, play-in-editor (Ctrl+R runs the real game on the level on screen), fly-camera playtest, and undo/redo behind **every** mutation. Save/load is semantically lossless, proven by self-tests that round-trip real shipped worlds.

The editor is game-agnostic: it opens any project with an `editor.project.json`, or any bare `*.world.json` via `--world <path>` (`--project <path>` skips the CWD walk). The adoption contract for new games is [`engine/docs/world-format.md`](https://github.com/Bloom-Engine/engine/blob/main/docs/world-format.md); the engine's `examples/world-viewer` is the reference consumer.

Models stream in one per frame at startup — the world appears immediately with colored placeholder boxes that pop into real meshes as their GLBs load (a status line counts down). Remaining slivers are tracked at the top of PLAN.md (prefab-tab thumbnails; optional `postSaveCommand` hook).

### Platform notes

Bringing this up on Windows required fixing three API mismatches in the editor (`Key.*` and `MouseButton.*` are `SCREAMING_SNAKE` in the engine, and `drawLine` takes a `Color`, not four channels) plus one engine gap (`setSceneNodeTransform` / `updateSceneNodeGeometry` couldn't cross the FFI — see `PLAN.md`). Also read [`docs/perry-map-size-av.md`](docs/perry-map-size-av.md) before putting a `Map` in editor state: Perry 0.5.x miscompiles `Map` fields declared on an interface.

## Building

Requires [Perry](https://github.com/andrewtdiz/perry) ≥ 0.5 on your `PATH`, and the [engine](https://github.com/Bloom-Engine/engine) checked out as a sibling directory named `../engine` (the `bloom` dependency resolves via `file:../engine/`).

```sh
perry compile src/main.ts
./main
```

`perry compile` emits the binary as `./main` (`main.exe` on Windows; pass `-o <name>` to change it). The native-library grant lives in `package.json` under `perry.allow.nativeLibrary`, so no environment variables are needed.

**Windows:** copy `dxcompiler.dll` and `dxil.dll` from `../engine/native/shared/` next to the binary once. Without them the Dx12 backend is unavailable and the editor crashes at window creation ("Failed to create surface") when launched from any directory that doesn't happen to contain them — which is why it used to work only from the shooter's root.

Run the self-test suite headless with:

```sh
./main --test
```

It prints failing assertions plus a summary and exits nonzero on any failure.

## Usage

The editor opens a **project**, described by an `editor.project.json` at the game's repo root:

```json
{
  "name": "Bloom Shooter",
  "gameId": "shooter",
  "modelsDir": "assets/models",
  "prefabsDir": "assets/prefabs",
  "worldsDir": "assets/worlds",
  "defaultWorld": "arena_01.world.json"
}
```

### Keyboard shortcuts

| Key | Action |
|---|---|
| `Q` / `W` | Select / Place tool |
| `G` / `R` / `E` | Move / Rotate / Scale gizmo |
| `B` | Terrain brush |
| `T` / `Y` | Water / River tool |
| `F` | Frame camera on selection |
| `Ctrl+Z` / `Ctrl+Y` | Undo / Redo |
| `Ctrl+S` | Save world |
| `Ctrl+D` | Duplicate selection |
| `Delete` | Delete selection |
| `Ctrl+P` | Toggle playtest (WASD fly-cam) |
| `Esc` | Cancel current operation |

## World format

Worlds are versioned JSON documents defined in the engine's shared module ([`engine/src/world/`](https://github.com/Bloom-Engine/engine/tree/main/src/world)): an environment block (sky, sun, ambient, fog, shadows), an optional heightmap terrain with splat layers, water box volumes, Catmull-Rom river splines, and a flat list of entities. Each entity references either a GLB model or a reusable `*.prefab.json`, and carries a TRS transform, optional tint, tags, and a free-form string `userData` map that games use for their own semantics (spawn points, pickups, triggers, …). Load/save round-trips are validated, and the format carries a schema version for future migrations.

## Repository layout

| Path | Contents |
|---|---|
| `src/main.ts` | Entry point: window, frame loop, input routing |
| `src/tools/` | Select, place, brush, water, river, prefab tools |
| `src/gizmos/` | Move / rotate / scale gizmos |
| `src/state/` | Editor state and the undo/redo command stack |
| `src/world-sync/` | Per-frame reconciliation of world data → scene graph |
| `src/viewport/` | Orbit camera, picking, grid, ray helpers |
| `src/ui/` | Immediate-mode widgets, theme, and panel layouts |
| `src/io/` | Project files, world I/O, asset catalog, recents |
| `src/playtest/` | Fly-camera playtest mode |
| `src/tests/` | Self-tests |
| `PLAN.md` | Audit + completion plan |
