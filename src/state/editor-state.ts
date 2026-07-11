// Central editor state — one global instance, passed to every tool, command,
// UI widget, and IO function as the first argument. This is the single source
// of truth for the editor; all mutation goes through commands (for undo) or
// direct setters (for transient state like camera position).

import {
  WorldData, EntityData, PrefabData, TransformData,
  Vec3Lit, Vec4Lit,
} from 'bloom/world';

// ---- sub-state types -------------------------------------------------------

export type EntityId = string;
export type ToolId = 'select' | 'place' | 'transform' | 'brush' | 'prefab' | 'water' | 'river';
export type TransformMode = 'move' | 'rotate' | 'scale';

export interface Project {
  filePath: string;          // Absolute path of editor.project.json.
  rootDir: string;           // Directory containing the project file.
  name: string;
  modelsDir: string;         // Resolved absolute.
  prefabsDir: string;
  worldsDir: string;
  defaultWorld: string;
}

export interface ModelEntry {
  relPath: string;           // Relative to project root, e.g. "assets/models/tree_oak.glb".
  displayName: string;       // Filename without extension.
  category: string;          // Derived from prefix: "tree_", "flower_", etc.
  modelHandle: number;       // Bloom Model.handle after loading.
  boundsMin: Vec3Lit;
  boundsMax: Vec3Lit;
  loaded: boolean;
}

export interface AssetCatalog {
  models: Map<string, ModelEntry>;    // Key = relPath.
  prefabs: Map<string, PrefabData>;   // Key = prefab id.
  modelOrder: string[];               // Stable iteration order for the panel.
  prefabOrder: string[];
  filter: string;                     // Substring filter for the asset panel.
  activeCategory: string;             // "all" or a category slug.
  activeTab: number;                  // 0 = Models, 1 = Prefabs.
}

export interface Selection {
  ids: Set<EntityId>;
  primary: EntityId | null;           // The one showing the gizmo + inspector.
}

export interface OrbitCamera {
  target: Vec3Lit;
  yaw: number;                        // Radians.
  pitch: number;                       // Radians, clamped to [-1.4, 1.4].
  distance: number;
  fovy: number;
  dirty: boolean;                      // True when inputs have moved the camera.
}

export interface SnapSettings {
  translate: number;                   // 0 = off, >0 = grid in world units.
  rotate: number;                      // 0 = off, >0 = degrees.
  scale: number;                       // 0 = off, >0 = step.
}

export interface BrushSettings {
  kind: 'raise' | 'lower' | 'smooth' | 'flatten' | 'paint';
  radius: number;
  strength: number;
  targetHeight: number;                // Used by flatten brush.
  activeLayerIdx: number;              // Used by paint brush.
}

export interface HandleMap {
  byEntity: Map<EntityId, number>;     // SceneNodeHandle.
  byHandle: Map<number, EntityId>;
}

// ---- main state object -----------------------------------------------------

export interface EditorState {
  // Project
  project: Project | null;

  // Assets
  catalog: AssetCatalog;

  // World
  worldPath: string | null;
  world: WorldData;
  editingPrefab: PrefabData | null;    // Non-null while in prefab edit mode.
  modified: boolean;

  // Selection
  selection: Selection;

  // Tools
  activeTool: ToolId;
  transformMode: TransformMode;
  placeAssetRef: string | null;        // "models/tree_oak.glb" or "prefab:small_house".

  // Camera
  camera: OrbitCamera;

  // Snap
  snap: SnapSettings;

  // Brush (visible when activeTool === 'brush')
  brush: BrushSettings;

  // Undo/redo
  undoStack: Command[];
  redoStack: Command[];
  maxHistory: number;

  // Scene sync
  handles: HandleMap;
  terrainHandle: number;               // 0 if no terrain node exists.
  pendingRebuild: Set<EntityId>;
  pendingDestroy: Set<number>;         // SceneNodeHandles to destroy this frame.
  pendingTerrainRebuild: boolean;
  pendingEnvironmentSync: boolean;

  // Viewport
  viewportLeft: number;                // Pixel x where the 3D viewport starts (after outliner).
  viewportRight: number;               // Pixel x where the 3D viewport ends (before asset panel).
  viewportTop: number;                 // Pixel y (after toolbar).
  viewportBottom: number;              // Pixel y (before status bar).

  // Playtest mode
  playtesting: boolean;
}

// ---- command interface -----------------------------------------------------

export interface Command {
  readonly label: string;              // "Place tree_oak", "Move 3 entities".
  do(state: EditorState): void;
  undo(state: EditorState): void;
  mergeWith?(next: Command): boolean;  // Coalesce drag ticks into one entry.
}

// ---- factory ---------------------------------------------------------------

import { createEmptyWorld } from 'bloom/world';

export function createEditorState(): EditorState {
  return {
    project: null,
    catalog: {
      models: new Map<string, ModelEntry>(),
      prefabs: new Map<string, PrefabData>(),
      modelOrder: [],
      prefabOrder: [],
      filter: '',
      activeCategory: 'all',
      activeTab: 0,
    },
    worldPath: null,
    world: createEmptyWorld('untitled', 'Untitled World'),
    editingPrefab: null,
    modified: false,
    selection: { ids: new Set<EntityId>(), primary: null },
    activeTool: 'select',
    transformMode: 'move',
    placeAssetRef: null,
    camera: {
      target: [0, 0, 0],
      yaw: 0.8,
      pitch: -0.5,
      distance: 20,
      fovy: 45,
      dirty: true,
    },
    snap: { translate: 0, rotate: 0, scale: 0 },
    brush: {
      kind: 'raise',
      radius: 5,
      strength: 0.5,
      targetHeight: 0,
      activeLayerIdx: 0,
    },
    undoStack: [],
    redoStack: [],
    maxHistory: 200,
    handles: {
      byEntity: new Map<EntityId, number>(),
      byHandle: new Map<number, EntityId>(),
    },
    terrainHandle: 0,
    pendingRebuild: new Set<EntityId>(),
    pendingDestroy: new Set<number>(),
    pendingTerrainRebuild: false,
    pendingEnvironmentSync: false,
    viewportLeft: 240,
    viewportRight: 1000,
    viewportTop: 36,
    viewportBottom: 776,
    playtesting: false,
  };
}

// ---- handle map helpers ----------------------------------------------------

export function bindEntity(map: HandleMap, id: EntityId, handle: number): void {
  map.byEntity.set(id, handle);
  map.byHandle.set(handle, id);
}

export function unbindEntity(map: HandleMap, id: EntityId): void {
  const handle = map.byEntity.get(id);
  if (handle !== undefined) {
    map.byHandle.delete(handle);
  }
  map.byEntity.delete(id);
}

export function entityOfHandle(map: HandleMap, handle: number): EntityId | null {
  const id = map.byHandle.get(handle);
  return id !== undefined ? id : null;
}

export function handleOfEntity(map: HandleMap, id: EntityId): number {
  const h = map.byEntity.get(id);
  return h !== undefined ? h : 0;
}

// ---- next entity id --------------------------------------------------------

export function nextEntityId(state: EditorState): string {
  const key = 'nextEntityId';
  const current = state.world.metadata[key];
  let n = 1;
  if (current !== undefined) {
    n = parseInt(current);
    if (n !== n) n = 1; // NaN guard
  }
  state.world.metadata[key] = (n + 1).toString();
  return 'ent_' + n.toString().padStart(4, '0');
}
