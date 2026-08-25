# Implementation tracker: replace `ValSyncEngine` with event-driven stores

> Living implementation plan for retiring `packages/ui/spa/ValSyncEngine.ts` in
> favour of small communicating stores. Keep the "Current state" block at the top up
> to date after every work chunk, as `jsonValues.md` does.
>
> Based on the `json-values` branch, because that branch already moved all patch
> application and all validation client-side — which is what makes this possible.

---

## Current state / resume here

> **Step 0 is DONE (2026-08-19)** — four independent fixes to the existing engine,
> shipped as four commits. Two of them were plain bugs, not just slowdowns:
>
> 1. `Field` — the wrapper around every leaf field — no longer calls
>    `useAllSources()` / `useSchemas()` during render. It used them only inside a
>    click handler, so every keystroke was deep-cloning the whole project and
>    re-rendering every mounted field for data nobody was looking at. Replaced with
>    `useGetNavPath()`, an on-demand read.
> 2. `subscribe()`'s unsubscribe spliced by an index captured at subscribe time, so
>    removing one listener detached a bystander. Listeners are now a `Set` keyed by
>    identity, and `emit` iterates a copy because unsubscribing mid-emit is normal.
> 3. `getSourceSnapshot` is cached per MODULE, not per field instance — the
>    `creatorId` in the cache key meant one full deep clone of the module per
>    mounted field, per keystroke. The `optimistic` flag it was carrying is now a
>    separate cheap call, `isOptimisticFor()`.
> 4. `subscribe()` is memoised per `(type, paths)`, so React stops tearing down and
>    re-adding every subscription on every render.
>
> Eight new tests, each verified to fail on the previous code. `jest` 1280 passing;
> `eslint` and `prettier` clean; `tsc` identical to the base branch.
>
> **Still true: nothing has been measured in a browser.** Every claim above is read
> off the code. The four commits are deliberately separate so a bench harness can be
> checked out at each one and attribute the win per fix.
>
> **Next decision:** whether to build the Storybook bench harness (Step 1) or the new
> hook contract (Step 2) first. Measuring first is the safer order — it is the only
> way to know whether Step 0 already bought most of the win, and therefore whether
> the store rewrite is worth its cost.
>
> **Decisions already locked** (reasoning under "Three constraints worth stating plainly"):
>
> - The field-facing read contract is **async from day one**, even while it is backed
>   by a synchronous adapter over `ValSyncEngine`. Otherwise moving source into a
>   worker later is a rewrite of every field.
> - The module version key is a **monotonic revision counter**, not a sha.
> - Fields become **uncontrolled** (`defaultValue`); the field's DOM value is the
>   truth while the user edits it.
> - `ValSyncEngine` stays authoritative until the last store lands.
>
> **Also open:** whether to add `jest-environment-jsdom` to `packages/ui`. Step 0 hit
> this immediately — the regression guard for fix 1 had to be static (a source check)
> rather than behavioural, because no component can be rendered in the suite.
>
> **The known blocker** for the end state: `computeRender` executes the user's real
> `Schema` instances (closures for `select` and custom `validate`), which cannot be
> structured-cloned into a worker. So renders must become lazy and path-scoped before
> source can move off the main thread. If that turns out to be impossible, source
> stays on the main thread and the earlier steps still stand on their own.

---

## Context

`packages/ui/spa/ValSyncEngine.ts` is 5061 lines, one class, ~60 mutable fields and
~30 snapshot caches enumerated by hand in three places (field declarations, the
constructor at :327-391, `reset()` at :456-540). Its own header comment calls it
"a MASSIVE class" and says the two honest options are to accept and test it, or
to find a better model of the problem. This is the second option.

Three goals, in priority order:

1. **UI performance** — a keystroke currently costs work proportional to the
   whole project, not the edited field.
2. **Simpler logic** — small stores that each own one thing.
3. **Web-component readiness** — plain JS events as the transport, so a field
   need not be a React component to participate.

### Why it is slow today (read from the code, not guessed)

Rows marked **FIXED** were closed by Step 0; they are kept because they are the
evidence for why the rewrite is shaped the way it is, and because nothing here
has been confirmed with a browser profile yet.

| #   | Cause                                                                                                                                                                                                                                                                                                                                                                   | Evidence                                                                                                                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **FIXED (Step 0).** **`Field` — the wrapper around every leaf — called `useAllSources()`**, whose snapshot deep-clones **every module in the project** and is invalidated on every keystroke. It is used only to compute a nav path inside a click handler.                                                                                                             | [Field.tsx:79](packages/ui/spa/components/Field.tsx#L79), [ValSyncEngine.ts:2091](packages/ui/spa/ValSyncEngine.ts#L2091), [:698](packages/ui/spa/ValSyncEngine.ts#L698) |
| 2   | Subscriptions are **module-granular**, never path-granular — one keystroke wakes every field in the module, and the snapshot is a fresh object so React can never bail out.                                                                                                                                                                                             | `subscribe("source", moduleFilePath)` — [ValFieldProvider.tsx:1194](packages/ui/spa/components/ValFieldProvider.tsx#L1194)                                               |
| 3   | **FIXED (Step 0).** `getSourceSnapshot` **deep-cloned the whole module once per field instance**, because `creatorId` is in the cache key. N fields ⇒ N full clones per keystroke.                                                                                                                                                                                      | [ValSyncEngine.ts:1984](packages/ui/spa/ValSyncEngine.ts#L1984), [:2002](packages/ui/spa/ValSyncEngine.ts#L2002)                                                         |
| 4   | `invalidateSource` fans out globally: `source`, `sources`, `all-sources`, `all-validation-errors`, renders, overlay.                                                                                                                                                                                                                                                    | [ValSyncEngine.ts:667-716](packages/ui/spa/ValSyncEngine.ts#L667)                                                                                                        |
| 5   | `getAllValidationErrorsSnapshot` re-clones **every schema and every source** per read; #4 invalidates it per keystroke.                                                                                                                                                                                                                                                 | [ValSyncEngine.ts:2212](packages/ui/spa/ValSyncEngine.ts#L2212)                                                                                                          |
| 6   | `computeRender` runs the user's `select` over the whole module. `handboka` has `select` at **two** nested array levels.                                                                                                                                                                                                                                                 | [ValSyncEngine.ts:1004](packages/ui/spa/ValSyncEngine.ts#L1004)                                                                                                          |
| 7   | One validation worker round-trip **per keystroke** per module.                                                                                                                                                                                                                                                                                                          | `requestModuleValidation(mfp,{custom:true})` from `addPatch`                                                                                                             |
| 8   | `addPatch` dry-runs the patch (clone + apply, result discarded) only to test applicability.                                                                                                                                                                                                                                                                             | [ValSyncEngine.ts:2507](packages/ui/spa/ValSyncEngine.ts#L2507)                                                                                                          |
| 9   | **PARTLY FIXED (Step 0)** — the re-subscribe churn is gone now that `subscribe()` is memoised, but the duplication remains: ~20 `useSyncExternalStore` subscriptions per leaf field; `Field`'s `useFieldState` duplicates the schema/source/addPatch subscriptions `StringField` already makes.                                                                         | [useFieldState.ts](packages/ui/spa/components/useFieldState.ts)                                                                                                          |
| 9b  | **Reference resolution re-traverses the whole project per keystroke.** `getKeysOf` runs `traverseSchemas` over every schema and source, and `useKeysOf`'s `useMemo` depends on `allSources`, whose identity changes every keystroke. `results.includes(sourcePath)` inside the loop makes it O(n²). Same for `useRoutesOf`, `useRouteReferences`, `useReferencedFiles`. | [useKeysOf.ts:38-53](packages/ui/spa/components/useKeysOf.ts#L38), [getKeysOf.ts:29](packages/ui/spa/components/getKeysOf.ts#L29)                                        |
| 9c  | Validation's read path **depends on** that reference resolution: `resolveSchemaSourceFixes` resolves `keyof:check-keys` / `router:check-route` against the whole-project schema+source snapshot. That is _why_ #5 needs `getAllSourcesSnapshot()`.                                                                                                                      | [ValSyncEngine.ts:2231](packages/ui/spa/ValSyncEngine.ts#L2231)                                                                                                          |
| 10  | **FIXED (Step 0).** **Live bug:** `subscribe`'s unsubscribe spliced by an index captured at subscribe time, so removing an earlier listener detaches the wrong later one; the array branch indexes `p[idx]` with a _listener_ index. Exercised constantly because `subscribe()` returns a fresh closure per render.                                                     | [ValSyncEngine.ts:628-638](packages/ui/spa/ValSyncEngine.ts#L628)                                                                                                        |

No `React.memo` / `useDeferredValue` / `startTransition` anywhere in
`packages/ui/spa`. `StringField` has no debounce (only `RichTextField`, 400 ms).

What Step 0 did **not** touch, and what the rewrite is therefore still for: rows 2,
4, 5, 6, 7, 8, 9b and 9c — module-granular subscriptions, the global invalidation
fan-out, whole-project validation and reference resolution, eager renders, and a
validation round-trip per keystroke.

### The real worst case — measured from a real project (`blankno-v3/web`)

31 modules, **407 KB** of `*.val.ts` source, no `.jsonValues()`.

| Module                        | Bytes  | Top-level keys | Shape                                                                                                                                                  |
| ----------------------------- | ------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `handboka/page.val.ts`        | 129 KB | **1** route    | `array(object{header, sections: array(object{header, slug, richtext})})`; ~550 richtext nodes; `.render({as:"list", select})` at **both** array levels |
| `arbeider/[slug]/page.val.ts` | 81 KB  | 26 routes      | rich per-route schema                                                                                                                                  |
| `jobb/[slug]/page.val.ts`     | 58 KB  | ~8 routes      | + images                                                                                                                                               |
| `events/[slug]/page.val.ts`   | 42 KB  | 13 routes      |                                                                                                                                                        |

The worst case is **not** many routes — it is one route holding a huge deeply
nested tree with `select` at two levels. Typing one character into a `sections[i].header`
inside `handboka` costs: a 129 KB deepClone (patch apply) + a 129 KB deepClone per
mounted field instance (snapshot) + a **407 KB** deepClone (`useAllSources`) +
`executeRender` over every chapter and section + a validation worker post.

---

## The design, in intent

### The contract inverts: the field owns its value

Today the engine is the truth and the field mirrors it — `StringField`'s `<Input>`
is controlled off local state that a `useEffect` re-syncs, gated on the
`isEditedByComponent` heuristic ([ValSyncEngine.ts:3272](packages/ui/spa/ValSyncEngine.ts#L3272))
which asks "is my last patch the last patch overall?". You want the field's DOM
value to be the truth while the user edits it: fields become uncontrolled
(`defaultValue`), the store never pushes at a field that is already current, and
the field is responsible for noticing drift and deciding what to do.

### Pull with a version handshake, not push

The field asks for its value quoting the head patch id it believes is current.
If that id is stale the reply is not a value — it is **"retry at `p57`"**. A stale
answer can therefore never win a race, and the read path is **async**, which is
what lets source move into a worker later without touching a single field.

### Events go out only for foreign changes

An update event fires for a path only when the patch that touched it was not
created by the listening field instance. **This needs no server change**: the
client already knows exactly which patch ids it created (`pendingClientPatchIds`
∪ `savedButNotYetGlobalServerSidePatchIds` ∪ `syncedServerSidePatchIds`); anything
in `globalServerSidePatchIds` outside that union is foreign. `sessionId` exists on
`PUT /patches` ([ApiRoutes.ts:701](packages/shared/src/internal/ApiRoutes.ts#L701))
but is never echoed back, so it is not usable for this — the set difference is.

### Stores replace the god-object incrementally

stat, schema, source, patch, patch set, **references**, network errors, patch
application errors, validation errors, search. `ValSyncEngine` stays authoritative
until the last one lands.

```
/stat ──► stat store ──── patch ids ────► patch store
            │                                │
            │ schemaSha / sourcesSha moved    │ foreign patch id
            ▼                                ▼
     schema store ◄──────────────────►  source store
            │                             │   ▲
            │        which patch-set ─────┘   │ apply (usually 1)
            │            paths?               │
            │              ▼                  │
            │       patch set store           │
            │              │                  │
            │              └── ∩ listeners ───┴──► emit events
            │                                 │
            └────────► references store ◄─────┘   (worker, lazy)
                             ▲
                             │ "resolve keyof/route for these errors"
                       validation store
```

The source store owns "ask patch sets → intersect with listeners → emit", so the
invariant _"if an event went out, the source behind it is already applied"_ holds
by construction.

### The references store

`s.keyOf()` and `s.route()` targets, plus referenced files. Today this is
recomputed **from scratch, on the main thread, on every keystroke**: `getKeysOf`
traverses every schema and source in the project, and `useKeysOf`'s `useMemo`
depends on `allSources`, whose identity changes per keystroke. It is also not
optional — validation's read path resolves `keyof:check-keys` /
`router:check-route` through `resolveSchemaSourceFixes` against the whole-project
snapshot, which is precisely why the validation snapshot needs `getAllSources`.

So the store is both a perf fix and the thing that lets validation stop cloning
the project:

```ts
// packages/ui/spa/stores/ReferencesStore.ts  — lives in the worker
export type ReferenceQuery =
  | { kind: "keyOf"; module: ModuleFilePath; key?: string }
  | { kind: "route"; route: string }
  | { kind: "file"; ref: string };

export type ReferenceResult =
  | { status: "ready"; referencedBy: SourcePath[]; revision: number }
  /** Some `.jsonValues()` entries are not loaded, so the answer is incomplete —
   *  a delete/rename guard must not act on this. Keeps today's contract from
   *  `useJsonValuesLoad.ts`. */
  | {
      status: "partial";
      referencedBy: SourcePath[];
      missingModules: ModuleFilePath[];
    }
  | { status: "computing" };

export interface ReferencesStore {
  query(q: ReferenceQuery): Promise<ReferenceResult>;
  /** Source store calls this; the index for that module is dropped, not rebuilt. */
  invalidate(moduleFilePath: ModuleFilePath): void;
}
```

Three properties, all of which today's code lacks:

- **Lazy.** Nothing is computed until someone asks — a validation resolve, a
  rename/delete guard, or `ReferencesList`. Not on every keystroke.
- **Incremental.** The index is a reverse map built per module. A source change
  invalidates _that module's_ slice and nothing else; the next query rebuilds only
  what is missing. Today every query rebuilds everything.
- **Off the main thread.** It only needs serialized schemas + sources, both of
  which structured-clone fine — no user closures involved. So unlike renders, this
  one can move into the worker immediately.

Also fix `results.includes(sourcePath)` → a `Set`; it is O(n²) today.

This is roadmap work (Step 4b), not in this chunk — but the Step 2 contract is
shaped so it drops in without changing fields.

---

## Three constraints worth stating plainly

**1. The async contract must be async from line one.** The end state is "worker owns
source, fields request slices async"; the first step is "a new hook contract over an
adapter on ValSyncEngine". Those are compatible only if the contract is async
even while the adapter answers instantly. If step 1 is allowed to be synchronous
because the adapter happens to be, moving source into a worker later is a rewrite
of every field. It will look like pointless indirection in step 1. It is not.

**2. Source cannot move into the worker early — and that is a sequencing fact, not
a rejection.** `computeRender` executes the user's real `Schema` _instances_
(`localSchemaInstances`) — closures for `select` and custom `validate`. Closures
cannot be structured-cloned into a worker. Same for custom validation. So the main
thread will keep needing patched source until renders are made **lazy and
path-scoped** (compute the render for visible rows, not the whole module). The
plan therefore reaches your end state in two moves: kill the clones and the
fan-out on the main thread first (that is where the lag actually is), then move
source across once the main thread's remaining consumers are explicit and coarse.

**3. The version key is a monotonic revision counter, not a sha** (decided). Your
idea was `sha(module source + patches on module)`, one key per module. The purpose
— "did this module change?" — is served exactly by a **monotonic integer the
source store bumps** when a module's applied patch list changes: no hashing on the
hot path, exactly correct within a session, comparison is one `===`. Cross-tab
comparison never needs it, because there we compare patch ids. The counter is also
_not_ the update mechanism: it is module-granular, so driving updates from it would
re-key every field in the module and reintroduce problem #2. **The per-path event
is the update path; the revision is what a field compares to answer "am I
current?" without asking.**

---

## Design

### The bus — one `EventTarget` per module

```ts
// packages/ui/spa/stores/SourceBus.ts
export const SOURCE_CHANGED = "val:source-changed";

export type SourceChangedDetail = {
  moduleFilePath: ModuleFilePath;
  /** Source paths whose value may have changed. Patch-set paths, so an ancestor
   *  path means "everything under me". */
  paths: SourcePath[];
  /** The revision the emitter had already applied when it emitted. */
  revision: number;
  /** Field instance that caused this, so it can ignore its own echo. */
  originFieldId: string | null;
};

/** An interface, not just a class — so tests inject a fake and assert on emits
 *  without a DOM, and so a web component can be handed the same object. */
export interface SourceBus {
  target(moduleFilePath: ModuleFilePath): EventTarget;
  emit(detail: SourceChangedDetail): void;
}

export class DomSourceBus implements SourceBus {
  private targets = new Map<ModuleFilePath, EventTarget>();
  target(moduleFilePath: ModuleFilePath): EventTarget {
    let t = this.targets.get(moduleFilePath);
    if (!t) {
      t = new EventTarget();
      this.targets.set(moduleFilePath, t);
    }
    return t;
  }
  emit(detail: SourceChangedDetail): void {
    this.targets
      .get(detail.moduleFilePath)
      ?.dispatchEvent(new CustomEvent(SOURCE_CHANGED, { detail }));
  }
}

/** Node-jest fake: records emits, and `target()` returns a real EventTarget
 *  (available in Node 16+), so store tests need no jsdom. */
export class RecordingSourceBus extends DomSourceBus {
  readonly emitted: SourceChangedDetail[] = [];
  emit(detail: SourceChangedDetail): void {
    this.emitted.push(detail);
    super.emit(detail);
  }
}
```

Why per-module `EventTarget` rather than `window` or a bespoke registry:

- It is a standard DOM API, so a web component subscribes with
  `addEventListener` and no adapter — that is goal 3, satisfied for free.
- The browser does the first level of filtering: a keystroke in module A never
  invokes a listener in module B. That alone removes today's global fan-out.
- Per-listener work becomes a string compare, so O(listeners in module) is
  irrelevant: mounted fields in one module are bounded by virtualization
  (`VirtualizedRecordList`, threshold 50 + overscan 8). The expensive part today
  is not the listener call, it is the deepClone + re-render each listener causes.

You asked for the listener match to be fast. It is fast because the work per
listener is now trivial, not because of a clever index. **If profiling says
otherwise, the fallback is a trie in the source store** keyed on path segments,
so `emit` dispatches only to matched listeners. Do not build the trie first —
build it if the bench says to.

The trie **is** needed in the patch-set store, for the different problem of
mapping patch ids to patch-set paths: `PatchSets.insertPath` is O(n·m) doing
`startsWith` against every known path, with its own TODO asking for exactly this
([PatchSets.ts:73](packages/ui/spa/utils/PatchSets.ts#L73)).

### The read protocol — and "absent" vs "not loaded yet"

This has been a long-running source of bugs, and it should be simple: **if the
module is loaded and its patches are all applied, we know whether the path is
there.** The fix is to make that a store invariant instead of something each field
re-guesses.

Why it is ambiguous today: `getSourceSnapshot` returns `source-not-found` both
when the module has not loaded (`moduleData === undefined`,
[:1993](packages/ui/spa/ValSyncEngine.ts#L1993)) and, downstream, when the path is
genuinely absent — and `useShallowSourceAtPath` _also_ returns `{status:"not-found"}`
when `type` is merely `undefined` ([:1218](packages/ui/spa/components/ValFieldProvider.tsx#L1218)).
Three different situations, one status.

The new protocol splits them, and only the store may say `absent`:

```ts
// packages/ui/spa/stores/SourceReader.ts
export type SourceRead =
  | { status: "ok"; value: Json; revision: number }
  /** Read at a revision that is no longer current. Re-ask at `revision`. */
  | { status: "stale"; revision: number }
  /** DEFINITIVE: module loaded, every known patch applied, path is not there. */
  | { status: "absent"; revision: number }
  /** Says nothing about the path — we do not know yet. */
  | { status: "module-loading" }
  | { status: "error"; message: string };

export type ModuleLoadState =
  | { status: "not-asked" }
  | { status: "loading" }
  /** `serverSources[m]` present AND every id in the module's ordered patch list
   *  has data in the patch store. */
  | { status: "loaded"; revision: number }
  | { status: "error"; message: string };

export interface SourceReader {
  /** Async from day one: the adapter resolves immediately, a worker will not. */
  read(path: SourcePath, atRevision: number | null): Promise<SourceRead>;
  revision(moduleFilePath: ModuleFilePath): number;
  loadState(moduleFilePath: ModuleFilePath): ModuleLoadState;
}
```

The invariant, enforced in one place in the source store:

> `absent` is returned **iff** `loadState(module).status === "loaded"` — i.e.
> `serverSources[module]` is present _and_ every patch id in that module's ordered
> list has its data loaded. Otherwise the answer is `module-loading`, never
> `absent`.

That second clause matters: `orderedPatchIdsForModule`
([:1035](packages/ui/spa/ValSyncEngine.ts#L1035)) already **silently skips** patch
ids whose data has not arrived, so today a module can look loaded while its
patched source is missing edits — which is exactly how "it isn't there" and "it
hasn't loaded" get confused. In the new store that condition makes the module
`loading`, not `loaded`.

For `.jsonValues()` there is a third case that must not collapse into either: an
entry whose _marker_ is loaded but whose _content_ is not. That stays
`module-loading` for paths inside the entry, and `loaded` for the key set.

`"stale"` carries the current revision so the caller re-asks once and converges.
Cap retries (3) and fall through to `error` — an unbounded retry loop is the one
way this design can hang.

### HMR — keep it working, do not build for it

`setValModules` ([:3746](packages/ui/spa/ValSyncEngine.ts#L3746)) re-runs on every
HMR: it calls `extractValModules` (re-serializes and re-hashes **every** module),
adopts local schemas + sources wholesale, and then `requestAllModuleValidation()`
— validating everything. It is already sequence-guarded against out-of-order
results (`setValModulesSeq`).

Two requirements on the new stores, and deliberately nothing more:

1. **The source store must support rebase, not just append.** HMR swaps the base
   source under existing patches, so the store needs "replace base for module M,
   re-apply M's patches, bump M's revision". That is the same operation
   `/sources/~` needs, so it is not extra machinery.
2. **Bump revisions only for modules whose sha actually changed.** `extractValModules`
   already produces a per-module sha; comparing it is nearly free and stops one
   edit to one file from re-keying every field in the Studio. This is the only HMR
   optimisation worth doing.

Explicitly **not** doing: incremental extraction, partial re-validation on HMR, or
any dev-only code path in the stores. Dev-mode cost is not the problem we are
solving, and a second code path would make the stores harder to reason about.

### The in-sync invariant

A field is **current** iff `field.revision === reader.revision(module)`.

- Writing a patch returns the new revision, so the writing field stays current
  with no read. This is the rule _"never reload/sync if the field was loaded with
  the latest sources and the latest patches"_.
- A foreign patch bumps the revision, the field falls behind, the event fires,
  the field re-reads. It re-reads **only if** its path is in `detail.paths` and
  `detail.originFieldId !== myFieldId`.
- Two field instances on the same path (studio + inline overlay) both update,
  because the filter is per **field instance**, not per session. I chose instance
  granularity over the session granularity you wrote because it is strictly safer
  and still kills the echo that causes flash-back — flagging it as a deliberate
  deviation.

### The hooks

They stay deliberately thin: subscribe to an event, read from a store, keep one
piece of local state. All the thinking lives in the stores. Declared return
unions, per `.claude/CLAUDE.md` rule 4 — no `as const`.

**Path matching.** Reuse the boundary-safe idiom already used by
`applyValidationResult` ([:2902](packages/ui/spa/ValSyncEngine.ts#L2902)) — raw
`startsWith` false-positives (`"a"` is a prefix of `"ab"`):

```ts
// packages/ui/spa/stores/pathMatch.ts
function isSelfOrUnder(path: SourcePath, other: SourcePath): boolean {
  return (
    path === other ||
    path.startsWith(other + ".") ||
    path.startsWith(other + "?")
  );
}

/** A change at `c` affects `path` if c is an ancestor of path, or under it. */
export function touchesPath(changed: SourcePath[], path: SourcePath): boolean {
  for (const c of changed) {
    if (isSelfOrUnder(path, c) || isSelfOrUnder(c, path)) return true;
  }
  return false;
}
```

**Field identity.**

```ts
// packages/ui/spa/stores/hooks/useValFieldId.ts
let counter = 0;
export function useValFieldId(): string {
  const ref = useRef<string | null>(null);
  if (ref.current === null) ref.current = `f${++counter}`;
  return ref.current;
}
```

**Reading a value.** One `useEffect`, one listener, one `useState`.

```ts
// packages/ui/spa/stores/hooks/useValFieldValue.ts
export type FieldValue<T> =
  | { status: "loading" }
  | { status: "ready"; value: T; revision: number }
  | { status: "absent"; revision: number }
  | { status: "error"; message: string };

const MAX_STALE_RETRIES = 3;

export function useValFieldValue<T extends Json>(
  path: SourcePath,
  fieldId: string,
): { state: FieldValue<T>; resetKey: number } {
  const { reader, bus } = useValStores();
  const moduleFilePath = useMemo(
    () => Internal.splitModuleFilePathAndModulePath(path)[0],
    [path],
  );
  const [state, setState] = useState<FieldValue<T>>({ status: "loading" });
  const [resetKey, setResetKey] = useState(0);
  // A ref, not state: re-reads must not re-run the subscribe effect.
  const revisionRef = useRef<number | null>(null);

  const load = useCallback(
    async (isForeignChange: boolean, isCancelled: () => boolean) => {
      let at = revisionRef.current;
      for (let attempt = 0; attempt <= MAX_STALE_RETRIES; attempt++) {
        const res = await reader.read(path, at);
        if (isCancelled()) return;
        if (res.status === "stale") {
          at = res.revision;
          continue;
        }
        if (res.status === "ok") {
          revisionRef.current = res.revision;
          // The store guarantees the type matches the schema at this path.
          setState({
            status: "ready",
            value: res.value as T,
            revision: res.revision,
          });
        } else if (res.status === "absent") {
          revisionRef.current = res.revision;
          setState({ status: "absent", revision: res.revision });
        } else if (res.status === "module-loading") {
          setState({ status: "loading" });
        } else {
          setState({ status: "error", message: res.message });
        }
        // Only a foreign change discards what the user has typed.
        if (isForeignChange) setResetKey((k) => k + 1);
        return;
      }
      setState({
        status: "error",
        message: "Could not read a stable revision",
      });
    },
    [reader, path],
  );

  useEffect(() => {
    let cancelled = false;
    const isCancelled = () => cancelled;
    void load(false, isCancelled);

    const target = bus.target(moduleFilePath);
    const onChanged = (ev: Event) => {
      const { detail } = ev as CustomEvent<SourceChangedDetail>;
      if (detail.originFieldId === fieldId) return; // my own echo
      if (!touchesPath(detail.paths, path)) return; // not my path
      void load(true, isCancelled);
    };
    target.addEventListener(SOURCE_CHANGED, onChanged);
    return () => {
      cancelled = true;
      target.removeEventListener(SOURCE_CHANGED, onChanged);
    };
  }, [bus, moduleFilePath, path, fieldId, load]);

  return { state, resetKey };
}
```

`resetKey` is the forced-update escape hatch — bump it and React remounts the
input, discarding DOM state. It is bumped **only** on a foreign change to this
path, never on the field's own writes.

**Writing, with debounce** — it belongs here rather than in each field:

```ts
// packages/ui/spa/stores/hooks/useValWritePatch.ts
export function useValWritePatch(
  path: SourcePath,
  fieldId: string,
  debounceMs = 0,
): { write: (value: Json) => void; flush: () => void } {
  const { writer } = useValStores();
  const [moduleFilePath, modulePath] = useMemo(
    () => Internal.splitModuleFilePathAndModulePath(path),
    [path],
  );
  const patchPath = useMemo(
    () => Internal.createPatchPath(modulePath),
    [modulePath],
  );
  const pendingValue = useRef<Json | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const send = useCallback(
    (value: Json) => {
      writer.write({
        moduleFilePath,
        fieldId,
        patch: [{ op: "replace", path: patchPath, value }],
      });
    },
    [writer, moduleFilePath, fieldId, patchPath],
  );

  const flush = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (pendingValue.current !== undefined) {
      send(pendingValue.current);
      pendingValue.current = undefined;
    }
  }, [send]);

  // An unmount mid-debounce must not silently drop the user's last edit.
  useEffect(() => () => flush(), [flush]);

  const write = useCallback(
    (value: Json) => {
      if (debounceMs <= 0) {
        send(value);
        return;
      }
      pendingValue.current = value;
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(flush, debounceMs);
    },
    [debounceMs, send, flush],
  );

  return { write, flush };
}
```

Debounce here is a _different_ thing from the engine's existing `canMerge`
coalescing ([:3084](packages/ui/spa/ValSyncEngine.ts#L3084)): that merges patches
already created, this avoids creating them. Default `0` for the prototype so the
bench measures the architecture rather than a timer; the bench then sweeps
`debounceMs` ∈ {0, 50, 150} as a separate row so we can see what it is worth.
`RichTextField` already picked 400 ms by hand — this replaces that with something
uniform.

**Sync state / drift check.** The timer re-arms on each write; when it fires, the
field's own value is compared with the store's.

```ts
// packages/ui/spa/stores/hooks/useValFieldSyncState.ts
export type FieldSyncState =
  | { status: "in-sync" }
  | { status: "pending"; patchIds: PatchId[] }
  | {
      status: "drifted";
      storeValue: Json;
      reapply: () => void;
      reset: () => void;
    }
  | { status: "patch-not-synced"; patchIds: PatchId[]; retry: () => void }
  | {
      status: "patch-not-applied";
      errors: { patchId: PatchId; message: string }[];
    };

export function useValFieldSyncState(
  path: SourcePath,
  fieldId: string,
  getCurrentValue: () => Json,
  onReset: (value: Json) => void,
  idleMs = 800,
): FieldSyncState {
  const { reader, patchStore, writer } = useValStores();
  const [state, setState] = useState<FieldSyncState>({ status: "in-sync" });
  // Refs so a changing callback identity never re-arms the timer.
  const getCurrent = useRef(getCurrentValue);
  getCurrent.current = getCurrentValue;
  const reset = useRef(onReset);
  reset.current = onReset;

  // Bumped by the patch store on every write this field makes.
  const writeTick = useSyncExternalStore(
    patchStore.subscribeFieldTick(fieldId),
    () => patchStore.fieldTick(fieldId),
  );

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      const mine = patchStore.forField(fieldId);
      if (mine.unappliable.length > 0) {
        setState({ status: "patch-not-applied", errors: mine.unappliable });
        return;
      }
      if (mine.unsynced.length > 0) {
        setState({
          status: "patch-not-synced",
          patchIds: mine.unsynced,
          retry: () => writer.retry(mine.unsynced),
        });
        return;
      }
      const res = await reader.read(path, null);
      if (cancelled) return;
      if (res.status !== "ok") {
        setState({ status: "in-sync" });
        return;
      }
      const current = getCurrent.current();
      if (deepEqual(res.value, current)) {
        setState({ status: "in-sync" });
        return;
      }
      setState({
        status: "drifted",
        storeValue: res.value,
        reapply: () =>
          writer.write({
            moduleFilePath: moduleOf(path),
            fieldId,
            patch: [{ op: "replace", path: patchPathOf(path), value: current }],
          }),
        reset: () => reset.current(res.value),
      });
    }, idleMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [writeTick, path, fieldId, idleMs, reader, patchStore, writer]);

  return state;
}
```

**The new `StringField`**, in full for the `<Input>` branch:

```tsx
const fieldId = useValFieldId();
const { state, resetKey } = useValFieldValue<string>(path, fieldId);
const { write, flush } = useValWritePatch(path, fieldId, debounceMs);
const inputRef = useRef<HTMLInputElement>(null);
const sync = useValFieldSyncState(
  path,
  fieldId,
  () => inputRef.current?.value ?? "",
  (value) => {
    if (inputRef.current) inputRef.current.value = String(value);
  },
);

if (state.status === "loading")
  return <FieldLoading path={path} type="string" />;
if (state.status === "absent")
  return <FieldNotFound path={path} type="string" />;
if (state.status === "error")
  return <FieldSourceError path={path} error={state.message} />;

<Input
  key={resetKey} // remount ONLY on a foreign change
  ref={inputRef}
  defaultValue={state.value} // uncontrolled: no re-render per keystroke
  onChange={(ev) => write(ev.target.value)}
  onBlur={flush}
/>;
// `sync` is returned for the caller to render however it likes — no UI here.
```

No `useState` for the value, no mirroring `useEffect`, no re-render per keystroke,
and `absent` now means absent rather than "possibly still loading".

### Failure surfaces

Three thin stores, each a `Map` plus an `EventTarget`, so a field reads one union
(above) and renders whatever it likes. Primitives only — no UI, per your ask.

- **network errors** — already `hasNetworkErrorTimestamp` + the transient queue.
- **patch application errors** — already `patchErrors: Record<ModuleFilePath, Record<PatchId, {message}>>`;
  needs a by-patch-id index so a field can ask "did _my_ patch fail?".
- **validation errors** — already worker-backed; the fix is that its read must
  stop cloning the project ([:2212](packages/ui/spa/ValSyncEngine.ts#L2212)).

---

## Later steps — design only, not yet agreed as work

Everything below is the design for the later steps, kept here so it survives.

### Step 1 — the bench harness

- `packages/ui/spa/bench/generateBenchModules.ts` — builds modules with `initVal()`'s
  `s`/`c` (type-safe, per test rules), parameterised to mirror blankno: a
  `handboka`-shaped module (1 route, nested `array(object{header, sections:
array(object{header, slug, richtext})})`, `select` at both levels, ~550 richtext
  nodes), a 26-route module, and ~28 small ones to hit 407 KB.
- `packages/ui/spa/bench/StringFieldBench.stories.tsx` — mounts a real `StringField`
  through the `InlineField.stories.tsx` provider stack (`ValThemeProvider >
TooltipProvider > ValRouter > ValErrorProvider > ValPortalProvider >
ValFieldProvider`) against a mocked `ValClient`, wraps it in `<Profiler>`, drives
  a deterministic 40-keystroke burst, and prints commits/keystroke, total and max
  `actualDuration`, and distinct committing components.
  - Keystrokes must be dispatched with the **native value setter** trick
    (`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set`)
    then an `input` event, or React's controlled input swallows them.
- Zero-cost `performance.mark`/`measure` probes behind a `__VAL_PERF__` flag around
  `getPatchedSource` ([:1868](packages/ui/spa/ValSyncEngine.ts#L1868)),
  `getSourceSnapshot`'s clone ([:2002](packages/ui/spa/ValSyncEngine.ts#L2002)),
  `getAllSourcesSnapshot` ([:2091](packages/ui/spa/ValSyncEngine.ts#L2091)),
  `invalidateSource` ([:667](packages/ui/spa/ValSyncEngine.ts#L667)),
  `computeRender` ([:1004](packages/ui/spa/ValSyncEngine.ts#L1004)), plus a
  deepClone call-count/bytes counter.

Run: `pnpm --filter @valbuild/ui storybook` → port 6006.

**Baseline table** — recorded here, before any fix, then again after each Step 0
item individually so we can see what each one bought:

|                                      | commits/keystroke | total commit ms | max commit ms | deepClone calls | bytes cloned | validation posts |
| ------------------------------------ | ----------------- | --------------- | ------------- | --------------- | ------------ | ---------------- |
| baseline                             |                   |                 |               |                 |              |                  |
| + 0.1 `useAllSources` out of `Field` |                   |                 |               |                 |              |                  |
| + 0.2 unsubscribe fix                |                   |                 |               |                 |              |                  |
| + 0.3 no clone / no `creatorId` key  |                   |                 |               |                 |              |                  |
| + 0.4 memoised `subscribe`           |                   |                 |               |                 |              |                  |
| Step 2 (new contract)                |                   |                 |               |                 |              |                  |

Fixtures: small (1 module, 5 KB), real (blankno mirror, 407 KB), worst (blankno ×3).
The measured field is a `sections[i].header` deep inside the `handboka`-shaped
module — the actual worst case. Add a second sweep over `debounceMs` ∈ {0, 50, 150}
once Step 2 lands, so the architecture's win and the debounce's win are separable.

Also record a **`keyOf` row**: mount a `KeyOfField` alongside the string field and
measure with/without, since `useKeysOf` traverses the whole project per keystroke
today (#9b). It quantifies the references store before we build it.

Honest limits to control for: Storybook is not `StrictMode` (the real SPA is —
[main.jsx:14](packages/ui/spa/main.jsx#L14)), dev React is slower than prod, the
mock client has no latency, and synthetic content with shared substructure clones
cheaper than real content. So Storybook numbers are for **ranking changes**; the
absolute claim gets confirmed once in the real Studio.

### Step 2 — the contract + adapter + new StringField

Files, all new except the last two:

| File                                   | What                                                                                                                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `stores/SourceBus.ts`                  | `SourceBus` interface, `DomSourceBus`, `RecordingSourceBus`                                                                                                                    |
| `stores/SourceReader.ts`               | `SourceRead`, `ModuleLoadState`, `SourceReader` interface                                                                                                                      |
| `stores/pathMatch.ts`                  | `touchesPath` / `isSelfOrUnder`                                                                                                                                                |
| `stores/ValSyncEngineAdapter.ts`       | implements `SourceReader` + `Writer` over the existing engine; emits on the bus from `invalidateSource`; derives `ModuleLoadState` from `serverSources` + `patchDataByPatchId` |
| `stores/ValStoresProvider.tsx`         | `useValStores()` — one context holding `{reader, writer, bus, patchStore}`                                                                                                     |
| `stores/hooks/useValFieldId.ts`        |                                                                                                                                                                                |
| `stores/hooks/useValFieldValue.ts`     |                                                                                                                                                                                |
| `stores/hooks/useValWritePatch.ts`     |                                                                                                                                                                                |
| `stores/hooks/useValFieldSyncState.ts` |                                                                                                                                                                                |
| `components/fields/StringField.tsx`    | new uncontrolled body, behind a flag so the old one stays reachable for A/B                                                                                                    |
| `ValSyncEngine.ts`                     | `invalidateSource` also emits on the bus; expose the load-state inputs the adapter needs                                                                                       |

The adapter is where the "async contract, sync backend" seam lives: `read()`
returns an already-resolved promise, and `revision()` is a per-module counter the
adapter bumps in `invalidateSource`. Nothing else knows the backend is synchronous.

Tests: node jest for `pathMatch`, the adapter's `ModuleLoadState` derivation
(including the `orderedPatchIdsForModule` skip case that makes a module `loading`
rather than `loaded`), and the stale-retry convergence. Storybook for the hooks.

**Then measure. This is the go/no-go gate for the whole plan** — if the numbers do
not move, we stop here rather than build nine stores on a wrong hypothesis.

### Steps 3-9 — store extraction (roadmap; NOT this chunk of work)

Listed so the contract in Step 2 is designed for where this is going. We decide
whether and how to proceed after reviewing the Step 2 numbers.

| Step | Store               | Thread | Owns                                                                                                                                                                                                 | Deletes from ValSyncEngine                                                           | Test                         |
| ---- | ------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------- |
| 3    | **patch**           | main   | the 5 patch-id lists, `patchDataByPatchId`, `isMine` predicate, pendingOps queue                                                                                                                     | ~600 lines                                                                           | node jest                    |
| 4    | **patch set**       | worker | `PatchSets` + a real trie replacing O(n·m) `insertPath`                                                                                                                                              | `PatchSets.ts` usage                                                                 | node jest (trie) + Storybook |
| 4b   | **references**      | worker | lazy, incremental reverse index for `keyOf` / `route` / file refs                                                                                                                                    | `getKeysOf`/`getRoutesOf` eager path, and `getAllSources` out of the validation read | node jest                    |
| 5    | **source**          | main   | `serverSources`, applied-patch lists, revision counters, listener registry                                                                                                                           | `getPatchedSource`, all snapshot getters                                             | node jest                    |
| 6    | **stat**            | main   | merges the two loops — the `/stat` long-poll/WS in `useStatus.ts` and the unconditional `setTimeout(sync,1000)` at [ValProvider.tsx:559](packages/ui/spa/components/ValProvider.tsx#L559) — into one | `sync`, `syncWithUpdatedStat`                                                        | node jest                    |
| 7    | **error** ×3        | main   | network / patch-application (indexed by patch id) / validation                                                                                                                                       | the error bag                                                                        | node jest                    |
| 8    | **source → worker** | worker | patched source; renders become lazy + path-scoped on main                                                                                                                                            | `computeRender` eager path                                                           | Storybook + walkthrough      |
| 9    | **rest of fields**  | —      | port remaining field types; **delete ValSyncEngine**                                                                                                                                                 | all of it                                                                            | full walkthrough             |

Ordering constraints that are real: 4 before 5 (source store needs patch-set paths
to emit); 3 before 5 (source store needs `isMine`); 4b before 7 (validation's read
resolves `keyof`/`route` through references, so the references store is what lets
validation stop cloning the project); 8 last of the store moves (renders must be
lazy first); 9 last.

Note 4b can move into a worker **immediately** — unlike source, it needs only
serialized schemas and sources, which structured-clone fine. No user closures are
involved. It is the cheapest genuine off-main-thread win in the roadmap.

### Inter-store transport

One typed message union over a `MessagePort`-shaped interface, so the _same_ store
code runs main↔main and main↔worker and a store can cross the boundary without
its callers changing:

```ts
export interface StorePort {
  post(msg: StoreMessage): void;
  request<Res>(msg: StoreRequest): Promise<Res>; // correlation-id under the hood
  on(handler: (msg: StoreMessage) => void): () => void;
}
```

Two implementations: `InProcessPort` (direct call, resolved promise) and
`WorkerPort` (`postMessage` + a `Map<id, resolve>`). Worker creation stays behind
an **injected factory** so `import.meta` never reaches jest-compiled code — the
existing pattern in `packages/ui/spa/validation/createValidationWorker.ts` and the
`ValSyncEngine` constructor param. Every worker client needs a main-thread
fallback, as `usePatchSetsWorker.ts:15` and `ValidationWorkerClient.ts:15` do.

What crosses the boundary matters: at 129 KB per module, shipping whole modules per
read defeats the purpose. Reads return **slices at a path**, and writes send
**patch ops only**.

### Out of scope unless it blocks us

`PUT /sources/~` re-evaluates and returns **all** modules unless exactly one
changed and every changed type is in `nonInterDependentTypes`
([:4949](packages/ui/spa/ValSyncEngine.ts#L4949), TODO at
[:4409](packages/ui/spa/ValSyncEngine.ts#L4409)). That is a server-side cost, not
the keystroke cost, so it is not in this plan — flagged because it will show up in
the walkthrough as a slow save.

---

## Verification

- **Node jest** covers every store: the existing `ValSyncEngine.test.ts` (2715
  lines, ~60 tests against a mock `ValClient`) is the pattern, and it must stay
  green through Steps 0-7 as the regression net.
- **Storybook** covers anything needing a DOM. Recommend **adding
  `jest-environment-jsdom` to `packages/ui`** — the jsonValues tracker lists this
  as an open decision, `@testing-library/react` is already a devDependency, and a
  per-file `@jest-environment jsdom` docblock is already an established pattern in
  `packages/next`/`packages/react`. It unlocks automated tests for the hooks
  (drift timer, resetKey, stale-retry), which are otherwise covered by nothing
  but manual clicking.
- **Real Studio**: `pnpm dev:example-next` (vite :5173 + example :3456, proxied by
  [packages/ui/src/server.ts:15](packages/ui/src/server.ts#L15)) → http://localhost:3456/val.
  Production numbers need `pnpm --filter @valbuild/ui build` (~6 min).
- **`docs/plans/sync-stores-walkthrough.md`** in the style of
  `docs/plans/jsonValues-walkthrough.md`: type a burst into a deep `handboka`-shaped
  field and confirm no dropped characters; open two tabs and confirm a foreign edit
  updates the other tab's field and that the typing tab is _not_ interrupted; kill
  the network mid-type and confirm `patch-not-synced` surfaces and recovers; make a
  patch unappliable and confirm `patch-not-applied` surfaces.
- **CI before declaring done** (per `.claude/CLAUDE.md`): `pnpm run lint`,
  `pnpm -w run format`, `pnpm run -r typecheck`, `pnpm test`, `pnpm run build`
  (then `pnpm preconstruct dev`), and `cd examples/next && pnpm run build`.

## Risks, ranked

1. **Renders keep source on the main thread** — the blocker on your worker-owned
   source. Mitigated by making renders lazy/path-scoped in Step 8; if that fails,
   source stays main-thread and we still keep the Step 0-7 win.
2. **The `optimistic` / `clientSideOnly` heuristic is load-bearing today** in more
   places than `StringField`. Removing it per-field is safe; removing it wholesale
   is not. Port field types one at a time (Step 9).
3. **Uncontrolled inputs lose behaviour** that controlled ones give free —
   programmatic resets, undo integration, IME composition. The `resetKey` covers
   resets; composition needs `compositionstart`/`end` handling so neither the
   debounce nor the drift timer fires mid-composition (Norwegian/Japanese input
   would otherwise write half-formed text).
4. **The drift timer could fight the user.** If `idleMs` is too short it fires
   while someone is thinking mid-sentence and reports drift that is really just a
   pending write. Mitigation: `flush()` the debounced write before comparing, and
   treat `pending` as in-sync rather than drifted.
5. **Two engines live at once** through Steps 2-8. Mitigated by the adapter: there
   is one source of truth (ValSyncEngine) until Step 5, and one after.
6. **Storybook numbers mislead** (dev React, no StrictMode, no latency, cheap
   synthetic clones). Mitigated by confirming the headline number once in a
   production build of the real Studio.
