// Self-tests — run via `bloom-editor --test` (wired in main.ts, which exits
// nonzero on any failure). Prints each failing assertion by name plus a
// pass/fail summary; runSelfTests returns the failure count.

import { WorldData, PrefabData, createEmptyWorld, createEntity } from 'bloom/world';
import { validateWorld, validatePrefab } from 'bloom/world';
import { buildHeightmapMesh, sampleHeight, defaultTerrain } from 'bloom/world';
import { expandPrefab, createPrefabRegistry, registerPrefab, PrefabLeaf } from 'bloom/world';
import { createEditorState, nextCounterId } from '../state/editor-state';
import { runCommand, undo, redo } from '../state/commands';
import { CreateEntityCommand } from '../state/commands/create-entity';
import { TransformEntityCommand } from '../state/commands/transform-entity';
import { CreateTerrainCommand } from '../state/commands/create-terrain';
import { SetUserDataCommand } from '../state/commands/set-userdata';

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
  testUserDataCommand();

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
