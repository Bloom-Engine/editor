# Bloom World Editor

An open-world editor for the [Bloom engine](https://github.com/Bloom-Engine/engine) — place entities, sculpt terrain, lay out water volumes and rivers, tune lighting and fog, and walk through the result, all in one native tool. Worlds are saved as plain-JSON `*.world.json` files (the engine's shared world format) and load directly into Bloom games such as [shooter](https://github.com/Bloom-Engine/shooter) and [garden](https://github.com/Bloom-Engine/garden).

Like everything in the Bloom ecosystem, the editor is written in TypeScript and compiled ahead-of-time to a native binary by [Perry](https://github.com/andrewtdiz/perry) — no browser, no Electron, no Node at runtime.

## Status

Core editing works; several planned features are unfinished. **[`PLAN.md`](PLAN.md)** contains a full verified audit (what works, what's broken, with file/line references) and the completion plan, including a definition of done. In short:

- **Working today:** entity placement and selection, move/rotate/scale gizmos, terrain sculpting (raise/lower/smooth/flatten), undo/redo, save/load with autosave, environment panel, fly-camera playtest mode.
- **Not finished yet:** prefab authoring UI, terrain texture painting, water/river editing beyond initial placement, `userData` editing, asset thumbnails, and a handful of bugs listed in the plan.

## Building

Requires [Perry](https://github.com/andrewtdiz/perry) ≥ 0.5 on your `PATH`, and the [engine](https://github.com/Bloom-Engine/engine) checked out as a sibling directory named `../engine` (the `bloom` dependency resolves via `file:../engine/`).

```sh
PERRY_ALLOW_PERRY_FEATURES=1 perry compile src/main.ts
./main
```

The env var is a temporary escape hatch until the `perry.allow.nativeLibrary` grant lands in `package.json` (task A1 in `PLAN.md`). `perry compile` emits the binary as `./main`.

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
