// Self-tests — run via `bloom-editor --test` (wired in main.ts, which exits
// nonzero on any failure). Prints each failing assertion by name plus a
// pass/fail summary; runSelfTests returns the failure count.

import { WorldData, PrefabData, WaterVolume, createEmptyWorld, createEntity } from 'bloom/world';
import { validateWorld, validatePrefab, listUnknownWorldFields } from 'bloom/world';
import { migrateWorldData, WORLD_SCHEMA_VERSION } from 'bloom/world';
import { loadWorld, saveWorld, loadPrefab, savePrefab, createEmptyPrefab } from 'bloom/world';
import { readFile } from 'bloom';
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
  RenameEntityCommand, SetTintCommand, SetTagsCommand, SetModelRefCommand,
} from '../state/commands/edit-entity';
import { SetEnvironmentCommand } from '../state/commands/set-environment';
import {
  AddTerrainLayerCommand, RemoveTerrainLayerCommand, TerrainPaintCommand, snapshotWeights,
} from '../state/commands/terrain-paint';
import { paintCell } from '../tools/brush-tool';
import {
  enterNewPrefabMode, enterPrefabEditMode, exitPrefabMode, wouldCycle,
} from '../tools/prefab-tool';
import { joinPath, projectRelative } from '../io/paths';
import { mouseToWorldRay, rayPlaneIntersect } from '../viewport/ray';

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

  testWorldFileRoundTrip();
  testPrefabFileRoundTrip();
  testUnknownFieldDetection();
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
  testMouseRay();
  testUserDataCommand();
  testEntityEditCommands();
  testEnvironmentCommand();
  testWaterCommands();
  testLightMigration();
  testSplatLayerCommands();
  testSplatPaintPartition();
  testSplatMaskPreview();

  console.log('self-tests: ' + passed + ' passed, ' + failed + ' failed');
  return failed;
}

// --- The real round-trip test (PLAN §K1) ---------------------------------------
//
// This replaces a synthetic test that round-tripped a small fresh object through
// `JSON.stringify` — the exact idiom that corrupts a parsed graph on Perry 0.5.x
// (perry-quirks #6), and not the code path saving actually uses. It was a green
// tick over the exact hole.
//
// This one exercises the REAL path on the REAL worlds: fixture copies of both
// shooter arenas (checked in under fixtures/, both schema v2 so no migration
// noise) go loadWorld → saveWorld → JSON.parse both → structural deep-compare.
// Any difference — a dropped field, a normalised number, a reordered array —
// is a saver bug to fix, not a tolerance to add. Text formatting is allowed to
// differ (the arenas were written by shooter tools with a different pretty-
// printer); parsed VALUES are not.

// Structural equality of two parsed-JSON values. Records dotted paths of the
// first few differences into `diffs` so a failure says WHERE, not just "false".
function deepJsonEqual(a: unknown, b: unknown, path: string, diffs: string[]): void {
  if (diffs.length >= 8) return; // enough to diagnose; don't flood the console

  if (a === null || b === null) {
    if (a !== b) diffs.push(path + ': ' + (a === null ? 'null vs value' : 'value vs null'));
    return;
  }

  const ta = typeof a;
  const tb = typeof b;
  if (ta !== tb) {
    diffs.push(path + ': type ' + ta + ' vs ' + tb);
    return;
  }

  if (ta === 'number' || ta === 'string' || ta === 'boolean') {
    if (a !== b) diffs.push(path + ': ' + a + ' vs ' + b);
    return;
  }

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) {
      diffs.push(path + ': array vs object');
      return;
    }
    if (a.length !== b.length) {
      diffs.push(path + ': length ' + a.length + ' vs ' + b.length);
      return;
    }
    for (let i = 0; i < a.length; i++) {
      deepJsonEqual(a[i], b[i], path + '[' + i + ']', diffs);
      if (diffs.length >= 8) return;
    }
    return;
  }

  // Plain objects. Key sets must match in both directions.
  const ka = Object.keys(a as Record<string, unknown>);
  const kb = Object.keys(b as Record<string, unknown>);
  for (let i = 0; i < ka.length; i++) {
    if (kb.indexOf(ka[i]) < 0) diffs.push(path + '.' + ka[i] + ': missing in saved output');
  }
  for (let i = 0; i < kb.length; i++) {
    if (ka.indexOf(kb[i]) < 0) diffs.push(path + '.' + kb[i] + ': added by saver');
  }
  if (diffs.length >= 8) return;
  for (let i = 0; i < ka.length; i++) {
    if (kb.indexOf(ka[i]) >= 0) {
      deepJsonEqual(
        (a as Record<string, unknown>)[ka[i]],
        (b as Record<string, unknown>)[ka[i]],
        path + '.' + ka[i],
        diffs,
      );
      if (diffs.length >= 8) return;
    }
  }
}

function roundTripWorldFixture(fixturePath: string, label: string): void {
  const original = readFile(fixturePath);
  if (!original || original.length === 0) {
    assert(false, 'roundtrip ' + label + ': fixture readable (' + fixturePath + ') — run from the editor root');
    return;
  }

  const world = loadWorld(fixturePath);
  const outPath = '__selftest_' + label + '.out.json';
  const saved = saveWorld(outPath, world);
  assert(saved.ok, 'roundtrip ' + label + ': saveWorld reports ok');
  if (!saved.ok) return;

  const written = readFile(outPath);
  // The historical failure mode: writeFile wrote 0 bytes and reported success.
  assert(written !== null && written.length > 0, 'roundtrip ' + label + ': saved file is not empty');
  if (!written || written.length === 0) return;

  const a = JSON.parse(original);
  const b = JSON.parse(written);
  const diffs: string[] = [];
  deepJsonEqual(a, b, 'world', diffs);
  for (let i = 0; i < diffs.length; i++) {
    console.log('  roundtrip ' + label + ' diff: ' + diffs[i]);
  }
  assert(diffs.length === 0, 'roundtrip ' + label + ': load->save is semantically lossless');
}

function testWorldFileRoundTrip(): void {
  roundTripWorldFixture('src/tests/fixtures/arena_01.world.json', 'arena_01');
  roundTripWorldFixture('src/tests/fixtures/arena_02.world.json', 'arena_02');
}

// Prefab save->load round-trip. Pins the 2026-07-15 fix: serializePrefab used to
// drop schemaVersion and bounds entirely (bounds came back undefined; the version
// was silently backfilled by migration, hiding the loss).
function testPrefabFileRoundTrip(): void {
  const p = createEmptyPrefab('rt_prefab', 'RT Prefab');
  assert(p.schemaVersion === WORLD_SCHEMA_VERSION,
    'prefab rt: createEmptyPrefab stamps the CURRENT schema version');

  p.bounds = { min: [-1, -2, -3], max: [4, 5, 6] };
  p.children.push({
    id: 'c0', modelRef: 'wall.glb', prefabRef: null,
    transform: { position: [1, 0, 2], rotation: [0, 0.5, 0], scale: [2, 1, 1] },
    tint: [1, 0.5, 0.25, 1], tags: ['wall'],
  });

  const outPath = '__selftest_prefab.out.json';
  const saved = savePrefab(outPath, p);
  assert(saved.ok, 'prefab rt: savePrefab reports ok');
  if (!saved.ok) return;

  const back = loadPrefab(outPath);
  assert(back.schemaVersion === WORLD_SCHEMA_VERSION, 'prefab rt: schemaVersion survives the round trip');
  assert(back.bounds !== null && back.bounds !== undefined, 'prefab rt: bounds survives the round trip');
  assert(back.bounds.min[0] === -1 && back.bounds.max[2] === 6, 'prefab rt: bounds values intact');
  assert(back.children.length === 1, 'prefab rt: child count');
  assert(back.children[0].modelRef === 'wall.glb', 'prefab rt: child modelRef');
  assert(back.children[0].tint !== null && back.children[0].tint![1] === 0.5, 'prefab rt: child tint');
  assert(back.children[0].tags.length === 1 && back.children[0].tags[0] === 'wall', 'prefab rt: child tags');
  assert(back.children[0].transform.rotation[1] === 0.5, 'prefab rt: child rotation');
}

// The editor cannot preserve fields it doesn't know (the saver is schema-
// explicit by literal key), so the contract is: detect them at load and warn.
// A world that came out of createEmptyWorld must list NOTHING — a false
// positive here would spam every load with bogus warnings.
function testUnknownFieldDetection(): void {
  const clean = createEmptyWorld('t', 'T');
  assert(listUnknownWorldFields(clean).length === 0, 'unknown fields: clean world lists none');

  const w = createEmptyWorld('t2', 'T2') as any;
  w.navmesh = { cells: [1, 2, 3] };                    // top-level extension
  const e = createEntity('e1', 'a.glb', [0, 0, 0]) as any;
  e.lootTable = 'common';                              // entity-level extension
  w.entities.push(e);

  const unknown = listUnknownWorldFields(w as WorldData);
  assert(unknown.length === 2, 'unknown fields: both extensions detected (got ' + unknown.length + ')');
  assert(unknown.indexOf('world.navmesh') >= 0, 'unknown fields: top-level path reported');
  assert(unknown.indexOf('world.entities[0].lootTable') >= 0, 'unknown fields: entity path reported');
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

// PLAN §F2: rename / tint / tags / modelRef, all undoable, rename and tint
// coalescing like drags do.
function testEntityEditCommands(): void {
  const state = createEditorState();
  runCommand(state, new CreateEntityCommand(createEntity('fe', 'a.glb', [0, 0, 0])));
  const e = state.world.entities[0];
  const baseDepth = state.undoStack.length;

  // Rename coalesces per entity: typing is one undo entry, not one per key.
  runCommand(state, new RenameEntityCommand('fe', 'a', 'ab'));
  runCommand(state, new RenameEntityCommand('fe', 'ab', 'abc'));
  assert(e.name === 'abc', 'edit: rename applied');
  assert(state.undoStack.length === baseDepth + 1, 'edit: renames coalesced');
  undo(state);
  assert(e.name === 'a', 'edit: rename undo restores the pre-typing name');

  // Tint: add, drag (coalesced), remove, undo chain.
  runCommand(state, new SetTintCommand('fe', null, [1, 1, 1, 1]));
  assert(e.tint !== null && e.tint[0] === 1, 'edit: tint added');
  runCommand(state, new SetTintCommand('fe', [1, 1, 1, 1], [0.5, 1, 1, 1]));
  runCommand(state, new SetTintCommand('fe', [0.5, 1, 1, 1], [0.2, 1, 1, 1]));
  assert(e.tint !== null && Math.abs(e.tint[0] - 0.2) < 0.001, 'edit: tint drag applied');
  undo(state);
  assert(e.tint !== null && e.tint[0] === 1, 'edit: tint drag undoes as ONE entry to pre-drag');
  runCommand(state, new SetTintCommand('fe', e.tint, null));
  assert(e.tint === null, 'edit: tint removed');
  undo(state);
  assert(e.tint !== null, 'edit: tint removal undone');

  // Tags are discrete: no coalescing, exact restore.
  runCommand(state, new SetTagsCommand('fe', [], ['wall']));
  runCommand(state, new SetTagsCommand('fe', ['wall'], ['wall', 'stone']));
  assert(e.tags.length === 2, 'edit: tags added');
  undo(state);
  assert(e.tags.length === 1 && e.tags[0] === 'wall', 'edit: tag undo removes only the last');

  // modelRef swap rebuilds the node (destroy+rebuild queued) and undoes.
  runCommand(state, new SetModelRefCommand('fe', 'a.glb', 'b.glb'));
  assert(e.modelRef === 'b.glb', 'edit: modelRef swapped');
  assert(state.pendingRebuild.has('fe'), 'edit: modelRef swap queues a rebuild');
  undo(state);
  assert(e.modelRef === 'a.glb', 'edit: modelRef undo restores the original');
}

// PLAN §I: environment edits go through the undo stack; merging is scoped per
// field so Ctrl+Z steps field by field, not "the whole tweaking session".
function testEnvironmentCommand(): void {
  const state = createEditorState();
  const origSun = state.world.environment.sunIntensity;
  const origFog = state.world.environment.fogStart;

  // A drag on one field: many ticks, one undo entry.
  const depth0 = state.undoStack.length;
  const b1 = { ...state.world.environment };
  state.world.environment.sunIntensity = 1.5;
  runCommand(state, new SetEnvironmentCommand('sunIntensity', b1, state.world.environment));
  const b2 = { ...state.world.environment };
  state.world.environment.sunIntensity = 2.0;
  runCommand(state, new SetEnvironmentCommand('sunIntensity', b2, state.world.environment));
  assert(state.undoStack.length === depth0 + 1, 'env: same-field edits coalesce');
  assert(state.pendingEnvironmentSync === true, 'env: sync flagged');

  // A different field starts a new entry.
  const b3 = { ...state.world.environment };
  state.world.environment.fogStart = 99;
  runCommand(state, new SetEnvironmentCommand('fogStart', b3, state.world.environment));
  assert(state.undoStack.length === depth0 + 2, 'env: different field is a separate entry');

  undo(state);
  assert(state.world.environment.fogStart === origFog, 'env: fog undo');
  assert(Math.abs(state.world.environment.sunIntensity - 2.0) < 0.001, 'env: sun survives fog undo');
  undo(state);
  assert(Math.abs(state.world.environment.sunIntensity - origSun) < 0.001, 'env: sun undo restores pre-drag');
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

  // The SAME disease one level up (found 2026-07-16, screenshot-verified):
  // `--project ../shooter/editor.project.json` makes rootDir '../shooter', the
  // load path '../shooter/assets/models/x.glb' — and the catalog key must
  // still be the project-relative 'assets/models/x.glb' the world stores.
  assert(projectRelative('../shooter', '../shooter/assets/models/prop_tree.glb')
    === 'assets/models/prop_tree.glb',
    'paths: --project catalog key strips the root back to the world modelRef');
  assert(projectRelative('.', 'assets/models/prop_tree.glb') === 'assets/models/prop_tree.glb',
    'paths: "." root is identity');
  assert(projectRelative('proj/', 'proj/assets/x.glb') === 'assets/x.glb',
    'paths: trailing-slash root strips cleanly');
  assert(projectRelative('../shooter', 'assets/models/unrelated.glb')
    === 'assets/models/unrelated.glb',
    'paths: a path outside the root passes through untouched');
}

// --- Mouse-ray unprojection ----------------------------------------------------
//
// This exists to EXECUTE mouseToWorldRay headless, not just to check its math:
// Perry 0.5.1208 miscompiled the previous body into a load from absolute
// address 8 (see the header comment in viewport/ray.ts), so the editor died
// with 0xc0000005 on the first placement click — and nothing in the suite ever
// CALLED the function, so 152 tests stayed green over a binary that crashed on
// click one. If the miscompile ever comes back, this test takes the whole
// --test run down with the same AV, which is exactly the alarm we want.
function testMouseRay(): void {
  const state = createEditorState();
  const cam = state.camera;

  // A ray through the viewport center must go from the eye toward the target.
  const ray = mouseToWorldRay(cam, 640, 400, 1280, 800, 240, 36, 800, 728);
  const dLen = Math.sqrt(ray.direction[0] * ray.direction[0] +
    ray.direction[1] * ray.direction[1] + ray.direction[2] * ray.direction[2]);
  assert(Math.abs(dLen - 1) < 0.001, 'ray: direction is normalized (got ' + dLen + ')');
  assert(ray.origin[0] === ray.origin[0] && ray.direction[0] === ray.direction[0],
    'ray: no NaNs');

  const toTargetX = cam.target[0] - ray.origin[0];
  const toTargetY = cam.target[1] - ray.origin[1];
  const toTargetZ = cam.target[2] - ray.origin[2];
  const dot = ray.direction[0] * toTargetX + ray.direction[1] * toTargetY +
    ray.direction[2] * toTargetZ;
  assert(dot > 0, 'ray: center ray points toward the orbit target');

  // Aim from above at the ground plane: the hit must land under the camera-ish,
  // and off-center rays must land off-center in the matching direction.
  const centerHit = rayPlaneIntersect(ray, [0, 0, 0], [0, 1, 0]);
  assert(centerHit !== null, 'ray: center ray hits the ground plane');

  const leftRay = mouseToWorldRay(cam, 340, 400, 1280, 800, 240, 36, 800, 728);
  const leftHit = rayPlaneIntersect(leftRay, [0, 0, 0], [0, 1, 0]);
  assert(leftHit !== null, 'ray: left-of-center ray hits the ground plane');
  if (centerHit !== null && leftHit !== null) {
    const dxc = leftHit[0] - centerHit[0];
    const dzc = leftHit[2] - centerHit[2];
    assert(Math.sqrt(dxc * dxc + dzc * dzc) > 0.01,
      'ray: different pixels produce different ground hits');
  }
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
