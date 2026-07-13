// Self-tests — run via `bloom-editor --test` (wired in main.ts, which exits
// nonzero on any failure). Prints each failing assertion by name plus a
// pass/fail summary; runSelfTests returns the failure count.

import { WorldData, PrefabData, WaterVolume, createEmptyWorld, createEntity } from 'bloom/world';
import { validateWorld, validatePrefab } from 'bloom/world';
import { migrateWorldData } from 'bloom/world';
import { buildHeightmapMesh, sampleHeight, defaultTerrain } from 'bloom/world';
import { createTerrainLayer, quantizeWeight, terrainLayerMaskColor } from 'bloom/world';
import { expandPrefab, createPrefabRegistry, registerPrefab, PrefabLeaf } from 'bloom/world';
import {
  createEditorState, nextCounterId,
  selectedEntityId, selectEntity, selectRiver,
} from '../state/editor-state';
import { EditWaterCommand, RemoveWaterCommand } from '../state/commands/edit-water';
import { runCommand, undo, redo } from '../state/commands';
import { CreateEntityCommand } from '../state/commands/create-entity';
import { TransformEntityCommand } from '../state/commands/transform-entity';
import { CreateTerrainCommand } from '../state/commands/create-terrain';
import { SetUserDataCommand } from '../state/commands/set-userdata';
import {
  AddTerrainLayerCommand, RemoveTerrainLayerCommand, TerrainPaintCommand, snapshotWeights,
} from '../state/commands/terrain-paint';
import { paintCell } from '../tools/brush-tool';
import {
  enterNewPrefabMode, enterPrefabEditMode, exitPrefabMode, wouldCycle,
} from '../tools/prefab-tool';
import { joinPath } from '../io/paths';

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string): void {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.log('FAIL: ' + name);
  }
}

export function runSelfTests(): number {
  passed = 0;
  failed = 0;

  testWorldRoundTrip();
  testValidation();
  testTerrainBilinearSample();
  testPrefabCycleDetection();
  testPrefabExpansion();
  testCommandUndoRedo();
  testMapSize();
  testCreateTerrainUndo();
  testCounterIds();
  testPrefabAuthoringMode();
  testPrefabAuthoringCycles();
  testPathJoinIdentity();
  testUserDataCommand();
  testWaterCommands();
  testLightMigration();
  testSplatLayerCommands();
  testSplatPaintPartition();
  testSplatMaskPreview();

  console.log('self-tests: ' + passed + ' passed, ' + failed + ' failed');
  return failed;
}

function testWorldRoundTrip(): void {
  const world = createEmptyWorld('test', 'Test World');
  world.entities.push(createEntity('ent_1', 'models/tree.glb', [5, 0, 3]));
  world.entities.push(createEntity('ent_2', 'models/rock.glb', [-2, 0, 7]));
  world.terrain = defaultTerrain();

  const json = JSON.stringify(world);
  const parsed = JSON.parse(json) as WorldData;

  assert(parsed.schemaVersion === world.schemaVersion, 'roundtrip: schemaVersion');
  assert(parsed.name === 'Test World', 'roundtrip: name');
  assert(parsed.entities.length === 2, 'roundtrip: entity count');
  assert(parsed.entities[0].id === 'ent_1', 'roundtrip: entity id');
  assert(parsed.entities[1].transform.position[2] === 7, 'roundtrip: position z');
  assert(parsed.terrain !== null, 'roundtrip: terrain not null');
  assert(parsed.terrain!.width === 128, 'roundtrip: terrain width');
}

function testValidation(): void {
  const world = createEmptyWorld('test', 'Test World');
  const result = validateWorld(world);
  assert(result.ok === true, 'validation: empty world ok');

  // Test duplicate entity id detection.
  world.entities.push(createEntity('dup', 'a.glb', [0, 0, 0]));
  world.entities.push(createEntity('dup', 'b.glb', [1, 0, 0]));
  const result2 = validateWorld(world);
  assert(result2.ok === false, 'validation: duplicate id caught');
  assert(result2.errors.length > 0, 'validation: has error message');
}

function testTerrainBilinearSample(): void {
  const t = defaultTerrain();
  // Default terrain is all zeros, so every sample should be 0 + origin.y.
  const h = sampleHeight(t, 0, 0);
  assert(Math.abs(h) < 0.01, 'terrain sample: center is ~0');

  // Set a known height and verify bilinear sampling.
  const cx = 64; // center cell
  const cz = 64;
  t.heights[cz * t.width + cx] = 5.0;
  const exact = sampleHeight(t, t.origin[0] + cx * t.cellSize, t.origin[2] + cz * t.cellSize);
  assert(Math.abs(exact - 5.0) < 0.01, 'terrain sample: exact cell = 5.0');
}

function testPrefabCycleDetection(): void {
  const registry = createPrefabRegistry();
  const prefabA: PrefabData = {
    schemaVersion: 1, id: 'a', name: 'A', children: [
      { id: 'child_b', modelRef: null, prefabRef: 'b', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, tint: null, tags: [] },
    ], bounds: { min: [0, 0, 0], max: [0, 0, 0] },
  };
  const prefabB: PrefabData = {
    schemaVersion: 1, id: 'b', name: 'B', children: [
      { id: 'child_a', modelRef: null, prefabRef: 'a', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, tint: null, tags: [] },
    ], bounds: { min: [0, 0, 0], max: [0, 0, 0] },
  };
  registerPrefab(registry, prefabA);
  registerPrefab(registry, prefabB);

  const leaves: PrefabLeaf[] = [];
  const errors: string[] = [];
  const visited = new Set<string>();
  expandPrefab(registry, 'a', [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], null, [], leaves, errors, visited, 'root');

  assert(errors.length > 0, 'cycle detection: errors reported');
  assert(errors[0].indexOf('cycle') >= 0, 'cycle detection: error mentions cycle');
  assert(leaves.length === 0, 'cycle detection: no leaves produced');
}

function testPrefabExpansion(): void {
  const registry = createPrefabRegistry();
  const prefab: PrefabData = {
    schemaVersion: 1, id: 'house', name: 'House', children: [
      { id: 'wall_0', modelRef: 'wall.glb', prefabRef: null, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, tint: null, tags: ['wall'] },
      { id: 'wall_1', modelRef: 'wall.glb', prefabRef: null, transform: { position: [2, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, tint: null, tags: ['wall'] },
      { id: 'roof', modelRef: 'roof.glb', prefabRef: null, transform: { position: [1, 2, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, tint: null, tags: ['roof'] },
    ], bounds: { min: [0, 0, 0], max: [3, 3, 1] },
  };
  registerPrefab(registry, prefab);

  const leaves: PrefabLeaf[] = [];
  const errors: string[] = [];
  const visited = new Set<string>();
  expandPrefab(registry, 'house', [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], null, [], leaves, errors, visited, 'root');

  assert(errors.length === 0, 'expand: no errors');
  assert(leaves.length === 3, 'expand: 3 leaves');
  assert(leaves[0].modelRef === 'wall.glb', 'expand: first leaf is wall');
  assert(leaves[2].modelRef === 'roof.glb', 'expand: third leaf is roof');
}

function testMapSize(): void {
  // Regression probe: Map.size at editor startup coincided with a native
  // access violation (0xc0000005) on Perry 0.5.1208 — keep this canary.
  const m = new Map<string, number>();
  assert(m.size === 0, 'map: empty size');
  m.set('a', 1);
  m.set('b', 2);
  assert(m.size === 2, 'map: size after set');
  m.delete('a');
  assert(m.size === 1, 'map: size after delete');
  // The editor AV'd specifically on string + Map.size concatenation.
  const viaLocal = m.size;
  assert(('n=' + viaLocal) === 'n=1', 'map: size concat via local');
  assert(('n=' + m.size) === 'n=1', 'map: size concat direct');
  console.log('map-size concat survived: n=' + m.size);
}

function testCreateTerrainUndo(): void {
  const state = createEditorState();
  assert(state.world.terrain === null, 'terrain cmd: starts null');

  runCommand(state, new CreateTerrainCommand());
  assert(state.world.terrain !== null, 'terrain cmd: created');

  undo(state);
  assert(state.world.terrain === null, 'terrain cmd: undo returns terrain to null');

  redo(state);
  assert(state.world.terrain !== null, 'terrain cmd: redo re-creates');
}

function testCounterIds(): void {
  const state = createEditorState();
  const a = nextCounterId(state, 'nextWaterId', 'water_');
  const b = nextCounterId(state, 'nextWaterId', 'water_');
  assert(a === 'water_1', 'counter: first id');
  assert(b === 'water_2', 'counter: second id');
  assert(state.world.metadata['nextWaterId'] === '3', 'counter: persists in world metadata');
}

function testUserDataCommand(): void {
  const state = createEditorState();
  runCommand(state, new CreateEntityCommand(createEntity('ud_ent', 'x.glb', [0, 0, 0])));

  runCommand(state, new SetUserDataCommand('ud_ent', 'cooldown', null, '5'));
  assert(state.world.entities[0].userData['cooldown'] === '5', 'userdata: set');

  runCommand(state, new SetUserDataCommand('ud_ent', 'cooldown', '5', '8'));
  assert(state.world.entities[0].userData['cooldown'] === '8', 'userdata: edit');

  undo(state);
  assert(state.world.entities[0].userData['cooldown'] === '5', 'userdata: undo restores previous value');

  runCommand(state, new SetUserDataCommand('ud_ent', 'cooldown', '5', null));
  assert(state.world.entities[0].userData['cooldown'] === undefined, 'userdata: remove');

  undo(state);
  assert(state.world.entities[0].userData['cooldown'] === '5', 'userdata: undo restores removed key');
}

function testWaterCommands(): void {
  const state = createEditorState();
  const volume: WaterVolume = {
    id: 'water_1',
    kind: 'box',
    center: [0, -1, 0],
    size: [10, 2, 10],
    surfaceHeight: 0.5,
    color: [0.2, 0.5, 0.8, 0.6],
    waveAmplitude: 0.1,
    waveSpeed: 1.0,
  };
  state.world.water.push(volume);

  // Edit coalescing: two drags on the same volume are one undo entry.
  const before = { ...volume, center: [0, -1, 0] as [number, number, number], size: [10, 2, 10] as [number, number, number], color: [0.2, 0.5, 0.8, 0.6] as [number, number, number, number] };
  const mid = { ...before, waveSpeed: 2.0 };
  runCommand(state, new EditWaterCommand('water_1', before, mid));
  const after = { ...before, waveSpeed: 3.0 };
  runCommand(state, new EditWaterCommand('water_1', mid, after));
  assert(state.world.water[0].waveSpeed === 3.0, 'water: edit applied');
  assert(state.undoStack.length === 1, 'water: consecutive edits coalesce into one undo entry');

  undo(state);
  assert(state.world.water[0].waveSpeed === 1.0, 'water: undo restores the pre-drag value');

  // Removal restores at the original index, so ordering round-trips.
  state.world.water.push({ ...volume, id: 'water_2' });
  runCommand(state, new RemoveWaterCommand(state.world.water[0], 0));
  assert(state.world.water.length === 1, 'water: removed');
  assert(state.world.water[0].id === 'water_2', 'water: the right one was removed');

  undo(state);
  assert(state.world.water.length === 2, 'water: remove undone');
  assert(state.world.water[0].id === 'water_1', 'water: restored at its original index');

  // Selecting a river must not let entity-only paths act on it.
  selectRiver(state, 'river_1');
  assert(selectedEntityId(state) === null, 'selection: a river is not an entity selection');
  selectEntity(state, 'ent_1');
  assert(selectedEntityId(state) === 'ent_1', 'selection: entity selection reads back');
}

// Schema v1 carried point lights as entities with userData.kind='point_light'.
// migrateWorldData must lift them into world.lights and drop them from
// entities, without touching anything else — this runs on every load of an old
// world, so a bug here silently mangles worlds.
function testLightMigration(): void {
  const world = createEmptyWorld('t', 'T') as any;
  world.schemaVersion = 1;
  world.lights = undefined;

  const lightEnt = createEntity('light_a', '', [3, 4, 5]);
  lightEnt.userData = {
    kind: 'point_light',
    range: '18',
    color: '1.0, 0.5, 0.25',
    intensity: '2.5',
  };
  const propEnt = createEntity('prop_a', 'models/crate.glb', [1, 0, 1]);

  world.entities.push(lightEnt);
  world.entities.push(propEnt);

  const migrated = migrateWorldData(world as WorldData);

  assert(migrated.schemaVersion === 2, 'migration: schemaVersion bumped to 2');
  assert(migrated.lights.length === 1, 'migration: one light lifted');
  assert(migrated.entities.length === 1, 'migration: light removed from entities');
  assert(migrated.entities[0].id === 'prop_a', 'migration: non-light entity untouched');

  const l = migrated.lights[0];
  assert(l.id === 'light_a', 'migration: light id preserved');
  assert(l.kind === 'point', 'migration: light kind');
  assert(l.position[0] === 3 && l.position[1] === 4 && l.position[2] === 5, 'migration: position carried over');
  assert(l.range === 18, 'migration: range parsed from userData');
  assert(l.intensity === 2.5, 'migration: intensity parsed from userData');
  assert(Math.abs(l.color[0] - 1.0) < 0.001 && Math.abs(l.color[1] - 0.5) < 0.001,
    'migration: color parsed from "r, g, b" string');

  // A v2 world must pass through untouched (migration is not re-run).
  const already = createEmptyWorld('t2', 'T2');
  already.lights.push({
    id: 'l1', name: 'l1', kind: 'point',
    position: [0, 1, 0], color: [1, 1, 1], intensity: 1, range: 5,
  });
  const again = migrateWorldData(already);
  assert(again.lights.length === 1, 'migration: v2 world is left alone');

  const v = validateWorld(again);
  assert(v.ok === true, 'migration: migrated world validates');
}

function testCommandUndoRedo(): void {
  const state = createEditorState();

  const entity = createEntity('test_ent', 'tree.glb', [5, 0, 3]);
  runCommand(state, new CreateEntityCommand(entity));
  assert(state.world.entities.length === 1, 'command: entity created');

  // Transform.
  const beforeT = { position: [5, 0, 3] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] };
  const afterT = { position: [10, 0, 3] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] };
  runCommand(state, new TransformEntityCommand('test_ent', beforeT, afterT));
  assert(state.world.entities[0].transform.position[0] === 10, 'command: transform applied');

  // Undo transform.
  undo(state);
  assert(state.world.entities[0].transform.position[0] === 5, 'command: undo transform');

  // Redo transform.
  redo(state);
  assert(state.world.entities[0].transform.position[0] === 10, 'command: redo transform');

  // Undo both.
  undo(state); // undo transform
  undo(state); // undo create
  assert(state.world.entities.length === 0, 'command: undo create');
}


// --- Prefab authoring mode (PLAN §E) ----------------------------------------
//
// The mode works by swapping the prefab's children in AS the world's entities, so
// every existing tool operates on them unchanged. These tests pin the two things
// that swap could plausibly get wrong: losing the world on the way out, and letting
// a prefab contain itself.
function testPrefabAuthoringMode(): void {
  const state = createEditorState();
  state.project = {
    root: '.', modelsDir: 'models', prefabsDir: 'prefabs',
    worldsDir: 'worlds', texturesDir: 'textures',
  } as any;

  // A world with one entity, and a dirty flag we expect to survive the round trip.
  runCommand(state, new CreateEntityCommand(createEntity('world_ent', 'a.glb', [1, 2, 3])));
  const worldRef = state.world;
  const undoDepth = state.undoStack.length;
  assert(state.world.entities.length === 1, 'prefab mode: world starts with 1 entity');

  // Entering swaps the world out for a neutral authoring stage.
  enterNewPrefabMode(state, 'camp', 'Camp');
  assert(state.editingPrefab !== null, 'prefab mode: entered');
  assert(state.world !== worldRef, 'prefab mode: world was swapped out');
  assert(state.world.entities.length === 0, 'prefab mode: new prefab starts empty');
  assert(state.world.terrain === null, 'prefab mode: authoring stage has no terrain');
  assert(state.undoStack.length === 0, 'prefab mode: history is separate');

  // Placing a part uses the ordinary entity command — that is the whole point.
  runCommand(state, new CreateEntityCommand(createEntity('part_0', 'tent.glb', [0, 0, 0])));
  runCommand(state, new CreateEntityCommand(createEntity('part_1', 'fire.glb', [2, 0, 0])));
  assert(state.world.entities.length === 2, 'prefab mode: parts placed as entities');

  // ...and so does undo.
  undo(state);
  assert(state.world.entities.length === 1, 'prefab mode: undo works on parts');
  redo(state);
  assert(state.world.entities.length === 2, 'prefab mode: redo works on parts');

  // Leaving must restore the world EXACTLY, history included.
  exitPrefabMode(state);
  assert(state.editingPrefab === null, 'prefab mode: exited');
  assert(state.world === worldRef, 'prefab mode: original world restored');
  assert(state.world.entities.length === 1, 'prefab mode: world entity survived');
  assert(state.undoStack.length === undoDepth, 'prefab mode: world history restored');
  assert(state.prefabStash === null, 'prefab mode: stash cleared');
}

// --- Cycle rejection (PLAN §E acceptance) ------------------------------------
//
// A prefab that contains itself expands forever at load and takes the game with it.
// Direct self-reference is the obvious case; the one that actually gets built by
// accident is transitive — A holds B, B holds A.
function testPrefabAuthoringCycles(): void {
  const state = createEditorState();

  // Catalog: b contains c, c contains a.
  state.catalog.prefabs.set('b', {
    id: 'b', name: 'B', children: [
      { id: 'x', modelRef: null, prefabRef: 'c',
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        tint: null, tags: [] },
    ],
  } as any);
  state.catalog.prefabs.set('c', {
    id: 'c', name: 'C', children: [
      { id: 'y', modelRef: null, prefabRef: 'a',
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        tint: null, tags: [] },
    ],
  } as any);
  state.catalog.prefabs.set('d', { id: 'd', name: 'D', children: [] } as any);

  // Not editing anything: nothing to cycle into.
  assert(!wouldCycle(state, 'b'), 'cycle: no-op outside prefab mode');

  enterNewPrefabMode(state, 'a', 'A');
  assert(wouldCycle(state, 'a'), 'cycle: direct self-reference rejected');
  assert(wouldCycle(state, 'b'), 'cycle: TRANSITIVE reference rejected (a -> b -> c -> a)');
  assert(wouldCycle(state, 'c'), 'cycle: one-hop transitive rejected (a -> c -> a)');
  assert(!wouldCycle(state, 'd'), 'cycle: an unrelated prefab is allowed');
  exitPrefabMode(state);
}


// --- Asset-key identity ------------------------------------------------------
//
// The catalog is keyed by the SAME string the world file stores in `modelRef`, and
// the two are built by different code paths. A path that is merely EQUIVALENT is
// not good enough — it has to be EQUAL, because the lookup is a Map.get.
//
// This is not hypothetical: rootDir came out as '.' whenever the project file sat
// in the CWD, so the catalog was keyed './assets/models/x.glb' while worlds said
// 'assets/models/x.glb'. Every lookup missed and the editor rendered the entire
// arena — trees, building, every prop — as grey placeholder cubes, silently.
function testPathJoinIdentity(): void {
  assert(joinPath('.', 'assets/models') === 'assets/models',
    'paths: "." root does not poison the key');
  assert(joinPath('./', 'assets/models') === 'assets/models',
    'paths: "./" root does not poison the key');
  assert(joinPath('', 'assets/models') === 'assets/models',
    'paths: empty root is a no-op');
  assert(joinPath('proj', 'assets/models') === 'proj/assets/models',
    'paths: a real root still joins');
  assert(joinPath('proj/', 'assets/models') === 'proj/assets/models',
    'paths: trailing slash is not doubled');
  // The thing that actually broke: catalog key must equal the world file's ref.
  const catalogKey = joinPath(joinPath('.', 'assets/models'), 'prop_tree.glb');
  assert(catalogKey === 'assets/models/prop_tree.glb',
    'paths: catalog key MATCHES the world modelRef');
}

// ---- Splat layers (PLAN §D) -------------------------------------------------

// Add / remove / paint, and what undo owes you afterwards.
//
// The one that matters: removing a PAINTED layer and undoing must give the paint
// back. A remove that only remembered the layer's name and texture would undo to
// a layer that is correctly named, correctly textured, and blank — and the paint
// would be gone with no error anywhere.
function testSplatLayerCommands(): void {
  const state = createEditorState();
  runCommand(state, new CreateTerrainCommand());
  const t = state.world.terrain as any;
  const cells = t.width * t.depth;

  runCommand(state, new AddTerrainLayerCommand('grass', 'assets/textures/g.png', 1.0));
  assert(t.layers.length === 1, 'splat: layer added');
  assert(t.layers[0].weights.length === cells, 'splat: weights sized to the grid');
  assert(t.layers[0].weights[0] === 0, 'splat: a new layer starts unpainted');
  assert(state.brush.activeLayerIdx === 0, 'splat: the new layer is selected');

  runCommand(state, new AddTerrainLayerCommand('rock', 'assets/textures/r.png', 1.0));
  assert(t.layers.length === 2 && state.brush.activeLayerIdx === 1, 'splat: second layer selected');

  // Paint layer 1 (rock) into cell 5, through a real command.
  const before = snapshotWeights(t.layers);
  paintCell(t.layers, 1, 5, 1.0, 1.0);
  runCommand(state, new TerrainPaintCommand(before, snapshotWeights(t.layers)));
  assert(t.layers[1].weights[5] === 1, 'splat: paint wrote the active layer');

  undo(state);
  assert(t.layers[1].weights[5] === 0, 'splat: undo reverts the stroke');
  redo(state);
  assert(t.layers[1].weights[5] === 1, 'splat: redo replays the stroke');

  // Remove the painted layer, then undo. The paint must come back.
  runCommand(state, new RemoveTerrainLayerCommand(1));
  assert(t.layers.length === 1, 'splat: layer removed');
  assert(state.brush.activeLayerIdx === 0, 'splat: selection clamped after removal');
  undo(state);
  assert(t.layers.length === 2, 'splat: undo restores the layer');
  assert(t.layers[1].weights[5] === 1, 'splat: undo restores the layer WITH its paint');

  // Undoing an add must not leave the brush pointing past the end of the list.
  runCommand(state, new AddTerrainLayerCommand('dirt', 'assets/textures/d.png', 1.0));
  assert(state.brush.activeLayerIdx === 2, 'splat: third layer selected');
  undo(state);
  assert(t.layers.length === 2, 'splat: undo removes the added layer');
  assert(state.brush.activeLayerIdx < t.layers.length, 'splat: activeLayerIdx stays in range');
}

// A splat is a partition of unity. If the weights at a cell can sum past 1, the
// shader blends 90% grass with 90% rock and the terrain goes uniformly grey —
// which looks like a lighting bug and is not one.
function testSplatPaintPartition(): void {
  const t = defaultTerrain();
  const layers = [
    createTerrainLayer(t, 'a', 'a.png', 1),
    createTerrainLayer(t, 'b', 'b.png', 1),
    createTerrainLayer(t, 'c', 'c.png', 1),
  ];
  const idx = 42;

  // Fill the cell with b, then paint a over it at full strength.
  paintCell(layers, 1, idx, 1.0, 1.0);
  assert(layers[1].weights[idx] === 1, 'partition: b painted to 1');
  paintCell(layers, 0, idx, 1.0, 1.0);
  assert(layers[0].weights[idx] === 1, 'partition: a painted to 1');
  assert(layers[1].weights[idx] === 0, 'partition: a fully displaced b');

  // A partial dab must leave the total at exactly 1, not above it.
  const l2 = [
    createTerrainLayer(t, 'a', 'a.png', 1),
    createTerrainLayer(t, 'b', 'b.png', 1),
  ];
  paintCell(l2, 1, idx, 1.0, 1.0);       // b = 1
  paintCell(l2, 0, idx, 1.0, 0.25);      // a = 0.25 -> b must fall to 0.75
  const sum = l2[0].weights[idx] + l2[1].weights[idx];
  assert(Math.abs(sum - 1.0) < 0.002, 'partition: weights sum to 1 after a partial dab (got ' + sum + ')');
  assert(Math.abs(l2[1].weights[idx] - 0.75) < 0.002, 'partition: b scaled proportionally');

  // Erase drives the active layer to 0 and does NOT push the others back up —
  // falling coverage is what lets the game blend back to its procedural base.
  paintCell(l2, 0, idx, 0.0, 1.0);
  assert(l2[0].weights[idx] === 0, 'partition: erase zeroes the active layer');
  assert(Math.abs(l2[1].weights[idx] - 0.75) < 0.002, 'partition: erase leaves the others alone');
  const cov = l2[0].weights[idx] + l2[1].weights[idx];
  assert(cov < 1.0, 'partition: erasing lowers total coverage');

  // Quantization is what keeps the world file from becoming a megabyte of noise.
  assert(quantizeWeight(0.5019607843137255) === 0.502, 'partition: weights quantize to 3dp');
  assert(quantizeWeight(-1) === 0 && quantizeWeight(2) === 1, 'partition: weights clamp to 0..1');
}

// The editor's paint preview is the heightmap mesh's vertex colour. If that
// stays grey no matter what you paint, the paint tool is invisible and therefore
// useless — so pin it.
function testSplatMaskPreview(): void {
  const t = defaultTerrain();
  const bare = buildHeightmapMesh(t);
  const STRIDE = 12;
  const r0 = bare.vertices[6];  // vertex 0, colour R

  t.layers = [createTerrainLayer(t, 'rock', 'rock.png', 1)];
  const unpainted = buildHeightmapMesh(t);
  assert(unpainted.vertices[6] === r0,
    'mask: adding an unpainted layer does not change the terrain');

  // Paint layer 0 fully at cell 0. Vertex 0's colour must become the mask colour.
  t.layers[0].weights[0] = 1.0;
  const painted = buildHeightmapMesh(t);
  const want = terrainLayerMaskColor(0);
  assert(Math.abs(painted.vertices[6] - want[0]) < 0.001 &&
         Math.abs(painted.vertices[7] - want[1]) < 0.001 &&
         Math.abs(painted.vertices[8] - want[2]) < 0.001,
    'mask: a fully-painted cell takes the layer mask colour');
  // ...and its neighbour, which nobody painted, must not have moved.
  assert(painted.vertices[STRIDE + 6] === r0,
    'mask: an unpainted cell keeps the bare colour');

  // A short weights array (hand-edited file, resized grid) must not produce NaN.
  t.layers[0].weights = [1.0];
  const ragged = buildHeightmapMesh(t);
  assert(ragged.vertices[STRIDE + 6] === r0, 'mask: a short weights array degrades to bare, not NaN');
}
