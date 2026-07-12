# Bloom World Editor

An open-world editor for the [Bloom engine](https://github.com/Bloom-Engine/engine) — place entities, sculpt terrain, lay out water volumes and rivers, tune lighting and fog, and walk through the result, all in one native tool. Worlds are saved as plain-JSON `*.world.json` files (the engine's shared world format) and load directly into Bloom games such as [shooter](https://github.com/Bloom-Engine/shooter) and [garden](https://github.com/Bloom-Engine/garden).

Like everything in the Bloom ecosystem, the editor is written in TypeScript and compiled ahead-of-time to a native binary by [Perry](https://github.com/andrewtdiz/perry) — no browser, no Electron, no Node at runtime.

## Status

Core editing works; several planned features are unfinished. **[`PLAN.md`](PLAN.md)** contains a full verified audit (what works, what's broken, with file/line references) and the completion plan, including a definition of done. In short:

- **Working today:** opens the shooter project and renders `arena_02` (entities with no model — spawners, pickups, colliders — draw as colored, pickable placeholder boxes); entity placement and selection, move/rotate/scale gizmos, terrain sculpting, undo/redo, save/load with autosave, `userData` key/value editing, environment panel, fly-camera playtest mode.
- **Not finished yet:** prefab authoring UI, terrain texture painting, water/river editing beyond initial placement, asset thumbnails, recent-projects UI.

Startup blocks for ~20 s while every GLB in the project's models dir is loaded synchronously (26 for the shooter). The window is black until that finishes — it is loading, not hung.

### Platform notes

Bringing this up on Windows required fixing three API mismatches in the editor (`Key.*` and `MouseButton.*` are `SCREAMING_SNAKE` in the engine, and `drawLine` takes a `Color`, not four channels) plus one engine gap (`setSceneNodeTransform` / `updateSceneNodeGeometry` couldn't cross the FFI — see `PLAN.md`). Also read [`docs/perry-map-size-av.md`](docs/perry-map-size-av.md) before putting a `Map` in editor state: Perry 0.5.x miscompiles `Map` fields declared on an interface.

## Building

Requires [Perry](https://github.com/andrewtdiz/perry) ≥ 0.5 on your `PATH`, and the [engine](https://github.com/Bloom-Engine/engine) checked out as a sibling directory named `../engine` (the `bloom` dependency resolves via `file:../engine/`).

```sh
perry compile src/main.ts
./main
```

`perry compile` emits the binary as `./main` (`main.exe` on Windows; pass `-o <name>` to change it). The native-library grant lives in `package.json` under `perry.allow.nativeLibrary`, so no environment variables are needed.

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
