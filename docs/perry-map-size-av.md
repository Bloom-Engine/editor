# Perry bug: `Map` fields on an interface are miscompiled

**Found:** 2026-07-11, while bringing the editor up on Windows.
**Toolchain:** Perry 0.5.1208, Windows 11, x86_64 (LLVM backend).
**Status:** open upstream; the editor works around it by never reading
`Map.prototype.size` through an interface field.

## Symptom

The process dies with an access violation (`0xC0000005`, exit
`-1073741819`). With `--debug-symbols`, `llvm-symbolizer` attributes the
faulting address to `perry_runtime::buffer::dataview::js_data_view_set`,
which is a red herring — the fault address drifts between builds and the
nearest-symbol attribution is not meaningful. The real story is that
`.size` lowers to `js_map_size(<raw i64 pointer>)` (see
`perry-codegen/src/expr/property_get.rs`), and the pointer it unboxes out
of the field is not a Map.

## Minimal repro

```ts
interface Two { a: Map<string, number>; b: Map<string, number>; }
const t: Two = { a: new Map<string, number>(), b: new Map<string, number>() };
console.error('size=' + t.a.size);   // ← access violation
```

No engine, no FFI, no window. `perry compile two.ts -o two && ./two`.

## What does and doesn't trigger it

| Shape | Result |
|---|---|
| One interface, one `Map` field, read `.size` | **PASS** |
| One interface, **two** `Map` fields, read `.size` | **CRASH** |
| One interface, three `Map` fields | **CRASH** |
| **Two** interfaces, one `Map` field each | **CRASH** |
| Same one-`Map` interface used for two fields | **PASS** |
| Two `Set` fields, read `.size` | **PASS** |
| One `Map` + one `Set` field | **PASS** |
| **Class** with two `Map` fields, read `.size` | **PASS** |
| Two `Map` fields, only `get`/`set`/`has` (no `.size`) | **PASS** |
| `Record<string, T>` instead of `Map` | **PASS** |

So the trigger is: **reading `.size` on a `Map`-typed field of an
interface-typed object, in a program that declares more than one `Map`
field across its interfaces.** `Map` methods are fine; `Set.size` is fine;
class fields are fine (`is_map_expr`'s `PropertyGet` arm resolves class
fields explicitly — interfaces evidently take a different path that
mis-resolves the receiver once more than one candidate field exists).

Reproduce the whole table with the bisect scripts kept alongside this note
in the scratchpad of the session that found it, or re-derive from the table
above — each row is ~10 lines.

## It is not only `.size`

`.size` is the loudest symptom (instant access violation), but the corruption
is in the **field read** itself. The editor never called `Map.size`, yet it
still died on the first frame:

```
TypeError: Expected number for native f64 parameter
    at src/world-sync/sync.ts:383
```

`HandleMap` was `interface { byEntity: Map; byHandle: Map }` — two `Map`
fields — and `Array.from(state.handles.byEntity.values())` on an *empty* map
returned bogus entries, which were then handed to `destroySceneNode()` and
rejected by the native ABI's number check. So any read of a `Map` field on a
multi-`Map` interface can yield garbage; `.size` merely dereferences it
immediately.

## Workaround (what the editor does)

1. **Hold `Map`s in a `class`, never a multi-`Map` interface.** `AssetCatalog`
   and `HandleMap` in `src/state/editor-state.ts` are classes for exactly this
   reason. With classes, `get` / `set` / `has` / `values()` / `keys()` all
   behave correctly (verified against the editor's exact shapes).
2. **Never read `.size` on a `Map` through a property chain** — that still
   crashes even when the holder is a class (`state.catalog.models.size` dies;
   the class-local `this.models.size` form is fine). Count via
   `Array.from(m.keys()).length`, or off a parallel array — the catalog keeps
   `modelOrder: string[]` beside `models: Map<...>`, so
   `catalog.modelOrder.length` is the count.
3. `Set.size` is safe through chains and is used freely (`pendingRebuild`,
   `pendingDestroy`).

## Debugging notes for the next person

- Perry's stdout is block-buffered and is **lost** when the process dies on a
  native fault. Print breadcrumbs with `console.error`.
- `llvm-symbolizer` attributed the fault to `js_data_view_set`, which is
  nearest-symbol noise — don't chase it.
- Instrumenting a crash with `console.log('n=' + someMap.size)` *introduces*
  this bug. That is how a debug line became the crash under investigation.
