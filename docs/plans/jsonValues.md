# Implementation tracker: `.jsonValues()` — lazily-loaded JSON entries

> Living implementation plan for `s.record(...).jsonValues()` / `s.router(...).jsonValues()`.
> The **design rationale + locked decisions** live in the approved design doc
> (`~/.claude/plans/i-want-a-new-humming-zebra.md`). This file tracks **what's done /
> what's next** so we can resume across sessions. Keep the "Current state" block at the
> top up to date after every work chunk.

---

## Current state / resume here

> **ALL non-manual Phase 6 work is DONE (2026-08-04), plus the CI gate.** Steps 5 and 6 landed, the two
> outstanding code items from the step 1–3 self-review are closed (a failed row can be retried instead of
> pulsing forever; the load-pass bound logs when it is exhausted), a self-review of steps 5–6 found and
> fixed three real defects (see _Review findings (self-review of steps 5–6)_), and the full six-job CI
> gate is green — including `packages/cli`, whose "pre-existing" chokidar typecheck failure turned out to
> be nothing but a stale local install.
> **What is left in Phase 6 is verification the model cannot do: the manual Studio walkthrough
> V1–V18 (V1 superseded; V1–V9 have still never been run).** Two decisions are waiting on Fredrik:
> browser caching for `/json`, and whether to add a jsdom jest project — without one, every UI half of
> steps 3, 5 and 6 is covered only by that walkthrough. Next code milestone: **Phase 7 stage 1**
> (renders from the client-side schema instances), which also absorbs old step 7.

> **Phase 6 step 6 DONE (2026-08-04): search over un-loaded entries.** Search is the one consumer the
> scoping rule cannot help — it indexes all content by definition — so `useAllJsonValuesLoad(enabled)`
> loads every jsonValues module, gated on user INTENT: the first non-empty query, NOT dialog open (radix
> mounts the content on open, so a mount effect would load there). Results come from whatever is indexed
> already and grow as batches land: the index rebuild is THROTTLED, not debounced — a debounce postpones
> every rebuild until the load goes quiet, which is exactly when partial results stop being useful — and
> `useSearchWorker` now reports an `indexVersion` so the query is re-run against each new index. The
> dropdown carries "Searching… N% indexed" off the progress store, suppresses "No results found" while
> the index is still filling (it would be a lie), and says so if the load failed. `traverseSchemaSource`
> (the LIVE search path, which never handled markers at all) now skips them, and the dead
> `createSearchIndex.ts` + `search.test.ts` + `search/index.ts` are gone. The worker's index builder moved
> to `search/searchIndex.ts` so the live path is testable at all: +3 tests there (incl. one that FAILS
> without the marker skip), +2 for `allJsonValuesModules`.

> **Phase 6 step 5 DONE (2026-08-04): the data-integrity hole is closed.** The three ref hooks
> (`useKeysOf`, `useEagerRouteReferences`, `useReferencedFiles`) now return a `ReferencesResult`
> (`loading` + percentage / `success` / `error` + retry) instead of a bare array, and the destructive
> popovers gate on `status === "success"` rather than on `refs.length`. The new hook
> `useReferenceScanStatus(query)` (in `components/useJsonValuesLoad.ts`) runs the step-4 predicate
> first, so the common case is `success` on the
> first render with ZERO requests; only an outward-pointing jsonValues item schema triggers
> `ensureJsonEntries`. Completeness is read from the engine on every render
> (`getJsonEntriesLoadStatus`) rather than held in component state — a held copy goes stale the moment a
> publish invalidates an entry, which is the same lie in a new place. That method also treats an entry
> whose refetch is IN FLIGHT as incomplete: the refetch clears the stale flag when it starts, so
> "not stale" alone would read as complete while pre-publish content is still in hand (V15). +5 tests
> (39 in the jsonValues describe).

> **Phase 6 step 4 DONE (2026-07-31): the load predicate.** `jsonValuesLoadRequirements(schemas, query)`
> answers "which jsonValues modules must be loaded before a reference scan can be trusted" from the
> SCHEMAS alone — no sources, no requests. Only root `.jsonValues()` records are candidates; their item
> schema is walked through object/array/record/union; an unknown schema type answers TRUE, because
> wrongly reporting "nothing to load" is how a guard starts lying. +9 tests.

> **Phase 6 step 3 DONE (2026-07-31): virtualized list + the real bug it exposed.** Reviewing the list
> view turned up something worse than "N broken previews": every row's `<Preview>` resolves its own path,
> and `useSchemaAtPathInternal` fires `requestJsonEntry` for any un-loaded marker it walks into — so
> opening a jsonValues record with N entries fired **N `/json` requests**. Fixed at the engine level by
> coalescing requests onto a microtask (one request per module per render pass) and deleting the
> single-entry fetch path entirely, so `ensureJsonEntry` shares `loadJsonEntriesSettled`. On top of that,
> `VirtualizedRecordList` virtualizes both list branches above 50 keys, requests only the rendered
> window, and swaps un-loaded rows for a fixed-height skeleton. +1 test (29 in the jsonValues describe).
> Self-review findings are recorded as tasks at the end of Phase 6 — two were fixed in the pass, seven
> remain (chiefly: no component tests, because the jest preset has no jsdom).
> **Next: step 4 — `jsonValuesLoadRequirements` predicate + tests.**

> **Phase 6 step 2 DONE (2026-07-31): engine primitives.** `requestJsonEntries(mfp, keys)`
> (fire-and-forget window) and `ensureJsonEntries(mfps)` (awaitable, whole-module, returns
> `{complete, errors}` so a guard can tell "loaded" from "failed") both delegate to one private
> `loadJsonEntries` — filter, chunk at 50, one `/json` per chunk, one `invalidateSource` per batch.
> Keys that exist only in a pending patch are never requested (no committed content to fetch; a request
> would 404 and wrongly mark the row errored). Progress is `{status, loaded, total, percentage}` on
> `subscribe("json-entries-progress")`, counted per RUN across modules so a percentage never resets at a
> module boundary. Publish invalidation is batched. +8 tests (28 in the jsonValues describe).
> **Next: step 3 — virtualize the record list + load the rendered window (V16).**

> **Phase 6 step 1 DONE (2026-07-31): batch `/json`.** `ValOps.getJsonEntries` is the single
> implementation (`getJsonEntry` is a one-key wrapper); `initSources`/`fetchPatches` are hoisted out of
> the per-entry loop; per-entry failures are per-entry (`missing`/`errors`) so one corrupt `*.val.json`
> cannot fail a batch; `offset`/`limit` refuses `apply_patches` rather than silently omitting
> draft-added keys. `keys` is a repeated query param (no plumbing needed — the client already serializes
> array query values). +14 tests, `pnpm test` 1118 green, `-r typecheck` clean, lint clean.
> **Next: step 2 — engine primitives (`requestJsonEntries` / `ensureJsonEntries` + progress store).**

> **Reference-integrity defect found (2026-07-30) — Phase 6 is the next milestone, step 1 done.**
> The Studio's three global scans (route refs, keyOf refs, referenced files) and search silently skip
> un-loaded `{_type:"json"}` markers, so the delete gate and the rename fixup can both answer "no
> references" for a ref that lives inside an entry the user happens not to have opened. That is a
> data-integrity hole, not a cosmetic one, and the result is nondeterministic (it depends on session
> history). Phase 6 below fixes it with a **schema-derived scoping rule** (in the common case NOTHING
> needs loading) plus a **batch `/json`** for the cases that do, and for search. Read Phase 6 before
> touching any of the `get*References` / `traverseSchemas` / search files.
> Phase 6 also covers the **record LIST view**, which turns out to be the most user-visible half: it
> renders a per-entry preview for every key, unvirtualized, so a jsonValues record currently shows N
> broken previews. Fix = virtualize with `@tanstack/react-virtual` + load only the rendered window.
> This **supersedes V1** ("zero `/json` on open").
> **Phase 7 (2026-07-31)** is the follow-on: the SPA already holds the user's REAL schema instances
> (`window.__VAL_MODULES__` → `extractValModules().schemas`) and throws them away in `setValModules`,
> re-deriving a lobotomised schema with `deserializeSchema` that has no render `select`, no custom
> validators and no router. Using the instances fixes renders (all schema types, draft-accurate) and
> finally lets custom validators run client-side. Phase 6 step 7 moved there.

> **Draft runtime path DONE (2026-07-28):** the last Phase 4 box is closed on the server + RSC side.
> `/json` takes `apply_patches` (default **true**, mirroring `/sources/~`) and replays pending
> patches via the new pure `applyJsonValuesEntryPatches`; the Studio passes `false` because it owns
> in-flight client patches. RSC `fetchValKey`/`fetchValRoute` read drafts through it when enabled and
> fall back to the local thunk. **jsonValues entries now get click-to-edit at all** — `stegaEncode`
> gained an optional `root` seed (entry path + serialized item schema), without which every
> jsonValues stega call was a silent identity transform. Also fixed `getSources` poisoning a
> jsonValues module's whole patch chain (observed live on the example support router).
> Still open: client `useValKey`/`useValRoute` render committed content in draft mode (needs the
> overlay emitter to carry patched sources — same limitation `useValStega` has today), and the
> **manual Studio walkthrough (V1–V9) has still NOT been run.**

> **Studio hardening DONE (2026-07-27):** the Phase 3 defects are fixed. Renaming an entry now
> commits (`move`/`copy` arms in `ValOps.prepare`), a published edit no longer appears to revert
> (json entry cache is invalidated on publish), a failed `/json` load renders an error instead of a
> forever-spinner, and nested `.jsonValues()` is rejected at startup. Also fixed a **pre-existing**
> bug found on the way: `analyzePatches` pushed one `patchesByModule` entry per op, so `prepare`
> re-applied the whole patch once per op (harmless for `replace`, corrupting for `move`).
> Automated tests green; the **manual Studio walkthrough (V1–V9 below) has NOT been run yet.**

> **Commit flow DONE (2026-07-03):** `ValOps.prepare` now routes patch ops for `.jsonValues()`
> records. Content edits write only the entry's `*.val.json` (the `.val.ts` is NOT touched); adding
> an entry writes a new `*.val.json` + inserts a `c.json(() => import("..."))` thunk into the
> `.val.ts`; removing an entry deletes the `*.val.json` (via a `patchedSourceFiles[path] = null`) +
> drops the thunk. All three go through the existing `patchedSourceFiles` map, so both `ValOpsFS`
> and `ValOpsHttp` commit them with no new abstraction. Server suite green (166), whole monorepo
> `pnpm test` green (1056), `-r typecheck` clean.

> **Studio lazy-load DONE (2026-06-30):** opening a jsonValues entry now fetches its content via
> `GET /json` and renders the fields (was: the `resolvePath` guard error). Read path works in both
> production (`fetchValKey`) and the Studio. **Editing** now persists on commit (see above).
> Requires `pnpm --filter @valbuild/ui build` for the Studio bundle to pick up UI changes (it's a
> built bundle, not a live dev-stub).

- **Phase**: 1 ✅. Phase 2 server: validation + loader + emit primitive + **/json endpoint** +
  **commit flow** ✅. Phase 3 UI lazy-load ✅ (Studio reads jsonValues entries). Phase 4:
  `fetchValKey`/`useValKey` + **`fetchValRoute`/`useValRoute`** ✅ (production path). Example
  (support pages) now uses `fetchValRoute`; `examples/next` `next build` green.
  **The `c.json` sha was removed (2026-07-02).** Remaining: end-to-end Studio verify of add/remove/
  edit against a running dev server; **Enabled/Studio draft runtime path** (all the single-entry read
  APIs still read the committed local thunk, not draft edits); full Phase 5 CI gate run.
- **Single-entry runtime read API (typecheck-validated, runtime-validation via example pending)**:
  - RSC `fetchValKey` — `initFetchValKeyStega` in `next/src/rsc/initValRsc.ts` (returned as
    `fetchValKeyStega`). Resolves ONE entry by key from the local module's thunk + stega-encodes.
  - Client `useValKey` — `useValKeyStega` in `next/src/client/initValClient.ts` (returned as
    `useValKeyStega`). Uses a module-level promise cache + `React.use` (Suspense) to load one entry.
  - `fetchValRoute`/`useValRoute` now also load a single entry for `.jsonValues()` routers (map
    params → key, then resolve one entry) — see Phase 4. ✅
  - Both: production path resolves the local thunk; Enabled/Studio **draft** path is a TODO (needs
    the single-entry endpoint + a sub-selector for stega edit tags).
- **Commit flow — DONE (2026-07-03)**. Persists edits to `*.val.json` instead of the `.val.ts`.
  Implementation landed:
  - **Key enabler**: `ValOps.prepare`'s `patchedSourceFiles: Record<path, string|null>` is written by
    the commit loop to **arbitrary paths** relative to rootDir (`null` = delete). `*.val.json`
    writes/deletes go through the same map (no new abstract FS method needed).
  - **AST analyzer**: `patch/ts/jsonValuesModule.ts` `analyzeJsonValuesEntries(sourceExpr)` →
    `Map<key, { importPath }>` (uses `analyzeValModule` to get the source object literal). Tested.
  - **Path helpers**: `patch/jsonValuesPatch.ts` — `getNewJsonEntryPaths(mfp, key)` (LOCKED
    convention below) + `resolveExistingJsonPath(mfp, importPath)` (existing/hand-placed files use
    the analyzer's importPath). Tested (`jsonValuesPatch.test.ts`).
  - **Op classifier**: `patch/jsonValuesPatch.ts` `classifyJsonValuesOp(serializedSchema, opPath)`
    walks the serialized schema; returns `{kind:"entry", recordPath, entryKey, subPath}` or
    `{kind:"normal"}`. Handles root records/routers (recordPath `[]`) AND nested jsonValues records.
  - **ts-ops**: `patch/ts/ops.ts` `insertValJsonEntry` / `removeValJsonEntry` insert/remove the
    `c.json(() => import(...))` property on the record's object literal (built with
    `createValJsonReference`, spliced with the internal `insertAt`/`removeAt`). Tested
    (`jsonValuesEntry.test.ts`).
  - **Routing in `prepare.applySourceFilePatches`**: fetches `this.getSchemas()` once, serializes per
    module, and processes each patch's `sourceFileOps` op-by-op (in order). Per op:
    1. `normal` → `applyPatch(tsSourceFile, tsOps, [op])` (unchanged behavior; `.val.ts` reformatted).
    2. `entry` + empty subPath → STRUCTURAL: `add` = new `*.val.json` + `insertValJsonEntry`;
       `remove` = `null` json + `removeValJsonEntry`; `replace` = whole-entry json content.
    3. `entry` + non-empty subPath → CONTENT: load current `*.val.json` (`getSourceFile` +
       `JSON.parse`, cached in a per-module map), then replay the **rebased** op via `jsonOps`
       (`rebaseContentOp` drops the record+entryKey prefix and rebases any move/copy `from`).
  - **`.val.ts` untouched on pure content edits**: `applySourceFilePatches` now returns
    `result: string | null` (`null` = ts unchanged) + `extraFiles: Record<path,string|null>`. The
    caller only writes `patchedSourceFiles[mfp]` when `result !== null`, and always merges
    `extraFiles`. So a content-only commit writes ONLY the `*.val.json`.
  - **Filename convention (LOCKED)**: new entry mirrors the key under a folder named after the
    `.val.ts` (its `.val.ts` suffix becomes the folder). Module `/app/foo/[...slug]/page.val.ts`,
    key `/foo/bar/zoo` → jsonPath `/app/foo/[...slug]/page/foo/bar/zoo.val.json`, importPath
    `./page/foo/bar/zoo.val.json`. EXISTING entries use the analyzer's importPath (hybrid authoring).
  - **Tested**: `ValOpsFS.jsonValues.test.ts` (content edit writes only json; add writes json +
    thunk; remove nulls json + drops thunk). Whole `pnpm test` green (1056).
  - Validation already handles inline content (`validateJsonValuesEntries` for base thunks;
    `executeValidate` validates inline content). `/sources/~` shallow markers already work
    (JSON.stringify drops the thunk).
- **Last verified green**: core json suite (14 tests) + server `validateJsonValues`/loader/
  `jsonReference` suites; core + server typecheck. (Earlier: whole-monorepo `-r typecheck` clean
  except the pre-existing unrelated `packages/cli` chokidar failure.)
- **Key API note**: `JsonSource` is a phantom-typed pure-JSON marker; the lazy thunk is
  runtime-only — read it with `Internal.getJsonImport(source)`, never `source._import` in typed code.
- **Done since**: server-side per-entry json validation (`validateJsonValues.ts`, wired into
  `ValOps.validateSources`); core `Internal.resolveJsonValues(source)` (eager resolver for the
  `fetchVal`/`useVal` path). **The sha was dropped (2026-07-02)** — `jsonValuesSha.ts` deleted, sha
  removed from `c.json`/`JsonSource`/`/json`/analyzer/example. **Discovered gap**: even eager
  `fetchVal` must resolve markers before stega-encoding (a jsonValues module's local source is
  markers, not content) — use `resolveJsonValues` there.
- **Runtime integration notes (for fetchValKey/fetchVal in next/react)**: disabled/production path
  reads the local module (`Internal.getSource`) whose markers still carry thunks → resolve locally
  (`getJsonImport` for one key, `resolveJsonValues` for all). Enabled/Studio path gets shallow
  markers from `/sources/~` WITHOUT thunks → needs the single-entry fetch endpoint (Phase 2) to load
  draft content; until then it can fall back to the local thunk (committed content only).

---

## Goal (one paragraph)

Let `s.record(...)` and `s.router(...)` (NOT `s.images()` / `s.files()` galleries) opt into
`.jsonValues()`, so each entry's value lives in its own `*.val.json` file referenced by a lazy
thunk `c.json(() => import("./x.val.json"))`. Keeps `.val.ts` tiny at 10K+
entries; runtime/Studio/validation work one entry at a time; zero overhead when Val is disabled.

## Locked decisions (do not relitigate)

1. `fetchVal`/`useVal` stay eager; new `fetchValKey`/`useValKey` + `fetchValRoute`/`useValRoute`
   load a single entry.
2. Hybrid authoring: Val generates/maintains json files + thunks; hand-edits re-validated.
3. **No sha (dropped 2026-07-02).** `c.json` takes ONLY the thunk:
   `c.json(() => import("./x.val.json"))`. The earlier sha / validation-cache-key idea (a
   `<schemaHash>-<contentHash>` token) was removed — not worth the complexity. There is no
   revalidation token: validation just runs on an entry's content when it is loaded (we accept that
   validation/builds take more time). `jsonValuesSha.ts` was deleted.
4. Type precision: keep object/array structure, widen only what JSON can't carry
   (literals → base, drop `RawString`/brand, widen `_type` literals). Runtime validation enforces
   strictness. Val object-unions are always discriminated, so distribute+recurse suffices.
5. i18n deferred; design json format locale-agnostic.
6. All-or-nothing: every entry of a `.jsonValues()` record is a `c.json` thunk (no mixing).
7. **Root-only (LOCKED 2026-07-27).** `.jsonValues()` is only supported on a module's ROOT
   record/router. A nested one is rejected at startup: `ValOps.initSources` reports a `ModulesError`
   per offender (via `findNestedJsonValuesRecords`), so `/sources/~` fails with "Val is not correctly
   setup" naming the module; the commit flow rejects nested entry ops as defense in depth.
   Rationale: the `/json` endpoint keys entries by a single string, the Studio substitutes content at
   the top level of the module source, and `validateJsonValuesEntries` only visits a root record —
   nested entries would silently get NO content validation. `classifyJsonValuesOp` still reports
   `recordPath` truthfully so the door stays open.
8. **A rename relocates the file (LOCKED 2026-07-27).** A `move` writes the destination via
   `getNewJsonEntryPaths` — the generated convention path — and deletes the source file. So renaming
   a hand-placed `content/faq.val.json` produces `page/support/faq2.val.json`. One invariant; the
   accepted cost is that renaming empties a hand-authored directory.

## Key runtime shapes

`JsonSource<T>` is a phantom-typed **pure-JSON marker** so `Source` stays JSON-serializable
(no `_sha`):

```ts
// JsonSource<T> TYPE (what flows through Source/SelectorSource):
{ _type: "json", patch_id?: string } & PhantomType<T>

// RUNTIME value produced by c.json(thunk) — also carries the thunk, which is
// NOT in the type; read it via Internal.getJsonImport(source):
{ _type: "json", _import: () => Promise<{ default: T }> }

// Over the wire (/sources/~): the marker only (thunk dropped):
{ _type: "json", patch_id?: string }
```

---

## Phase 1 — Core (`packages/core`) ✅

- [x] `source/json.ts`: `JsonSource<T>` (default `T = unknown` so the unions accept any
      content), `_type:"json"` const (`JSON_VAL_EXTENSION_TAG`), `json()` ctor, `isJson()`,
      `JsonOf<T>` transform (distribute + recurse + widen leaves).
- [x] `source/index.ts`: `JsonSource` added to `Source` union.
- [x] `selector/index.ts`: `JsonSource` in `SelectorSource`; mapped in `Selector<T>` →
      `GenericSelector<JsonSource>`.
- [x] `initVal.ts`: `json` added to `c` + `ContentConstructor`.
- [x] `schema/record.ts`: `.jsonValues()` modifier + `isJsonValues` flag; `Src` widened to
      `JsonValuesRecordSrc<T,K>`; serializes `jsonValues`; throws on media galleries; defers value
      validation (record-level only asserts `isJson` marker); `validateJsonEntryContent()` helper.
- [x] `schema/record.ts` (`SerializedRecordSchema`) + `schema/deserialize.ts`: carry `jsonValues`.
- [x] `module.ts` `resolvePath` (both variants): descend a json entry → schema becomes `item`;
      throws/returns clear error when traversing deeper into an unloaded marker.
- [x] `index.ts`: export `JsonSource`/`JsonOf` types + `Internal.isJson`.
- [x] Tests: `schema/jsonValues.test.ts` — `JsonOf` compile-time, `c.json` unit, serialize/
      deserialize round-trip, router compose, gallery rejection, deferred validation, authoring
      surface (`c.define` + `c.json`).
- [x] **Verified**: `pnpm test packages/core` (454 tests) + core typecheck green.

## Phase 2 — Server (`packages/server`)

- [x] `loadValModules.ts`: `loadModule` parses `.json` (mirrors Node `require` json); `.json` added
      to `RESOLVE_EXTENSIONS`; dynamic `import()` transpiles to a lazy `require` via `customRequire`
      so thunks stay lazy. Fixture: `test/jsonValues-fixture/` + `loadValModules.jsonValues.test.ts`
      (verifies marker shape, laziness, and thunk-loads-json). ✅
- [x] `patch/ts/ops.ts`: `createValJsonReference(importPath)` — emits `c.json(() => import("..."))`
      (factory-built; uses `createIdentifier("import")` to print a dynamic import without casting the
      ImportKeyword token). Tested in `jsonReference.test.ts`. ✅
- [x] `patch/ts/ops.ts`: `insertValJsonEntry` / `removeValJsonEntry` insert/remove a
      `c.json(() => import(...))` entry property on the record object literal (via
      `insertAt`/`removeAt` + `createValJsonReference`). Tested (`jsonValuesEntry.test.ts`). ✅
- [x] **Per-entry validation**: `validateJsonValues.ts` (`validateJsonValuesEntries`) loads each
      entry's content via `getJsonImport` and validates against the item schema; wired into
      `ValOps.validateSources` (runs before the `res === false` early-continue). Tested in
      `validateJsonValues.test.ts` (valid/invalid/load-error/non-jsonValues-skip). ✅
- [x] `ValOps.ts` commit flow: `prepare.applySourceFilePatches` routes ops via `classifyJsonValuesOp`
      and writes `*.val.json` (content edits) + inserts/removes `c.json(...)` thunks for add/remove
      through the existing `patchedSourceFiles` map (so `ValOpsFS`/`ValOpsHttp` commit them
      unchanged). `.val.ts` is not written on pure content edits. Tested
      (`ValOpsFS.jsonValues.test.ts`). ✅ (Still to confirm: shallow `/sources/~` serialization end to
      end against the Studio.)
- [x] Core eager resolver `Internal.resolveJsonValues(source)` (for `fetchVal`/`useVal`). ✅
- [x] `ValServer.ts` `/json`: fetch one entry's content, **draft-aware** (2026-07-28). It takes
      `apply_patches` (default TRUE, mirroring `/sources/~`); the Studio passes `false` because it owns
      in-flight client patches and would otherwise double-apply. The handler is a thin adapter over
      `ValOps.getJsonEntry(path, key, {applyPatches})`, which reads committed content from the import
      thunk (fs + http, no extra I/O) and replays pending patches with `applyJsonValuesEntryPatches`.
      NOTE: no `patch_id[]` pinning — no caller has patch ids, and `fetchPatches({patchIds})` is
      already there if one appears. `/sources/~` shallow markers fall out of `JSON.stringify` dropping
      the thunk. ✅
- [x] `getSources` is jsonValues-aware (2026-07-28). It used to apply entry-content ops with `jsonOps`
      against the opaque marker → "Cannot replace object element which does not exist", which then
      marked the module poisoned and skipped **every** later patch for it. Content sub-ops are now
      skipped (the module source is genuinely unaffected); whole-entry add/replace/move/copy push the
      MARKER so the key set stays right for drafts. ✅
- [x] **Verify**: `pnpm test packages/server/...` green. ✅

## Phase 3 — UI (`packages/ui/spa`) — NEXT MILESTONE (do with Studio running)

The Studio currently throws the (intentional) `resolvePath` guard when opening a jsonValues entry,
because entry content is never loaded into the client source tree. Concrete integration points
(all in the 3376-line `ValSyncEngine.ts` unless noted):

- [ ] **Content cache + fetch**: add `private jsonEntryContents: Record<ModuleFilePath, Record<key,
JSONValue>>` and `private loadingJsonEntries: Set<"mfp\0key">`. Add `requestJsonEntry(mfp, key)`
      that, if not loaded/loading, calls `this.client("/json", "GET", { query: { path: mfp, key } })`,
      stores `content`, then `invalidatePatchedSourcesCache(mfp)` + clears `cachedSourceSnapshots`
      for the module + `emit(this.listeners["source"]?.[mfp])` / `["sources"]` so subscribers
      re-render. (Mirror the existing `requestModuleValidation` side-effect pattern.)
- [ ] **Substitution before patches**: in `getPatchedSource(mfp)`, build the effective base by
      replacing each loaded json marker at `baseSource[key]` with `jsonEntryContents[mfp][key]`
      BEFORE applying patches (so field-level patches at `?p="key"."field"` apply on top). Markers
      without loaded content stay as-is (list view only reads keys). Invalidate the patched cache on
      load (above) since the effective base changed.
- [ ] **Trigger on open**: the field component that renders a navigated-to entry path must call
      `requestJsonEntry(mfp, key)` (effect on mount, keyed by path). Find the entry detail renderer
      (AnyField/Field at a path); when the path's parent schema is a `jsonValues` record and the
      marker isn't loaded, request it and render a loading state until `getSourceSnapshot` returns
      content. `useShallowSourceAtPath(path, "record")` already returns keys only (list is fine).
- [x] **Per-entry patches**: editing an entry field produces a normal patch at the entry path; on
      commit the server commit-flow writes the `*.val.json` (Phase 2 commit flow). Add/remove entry =
      add/remove the record key (commit flow emits/removes thunk + file). **Rename** (`move`) and
      duplicate (`copy`) now supported too — see Session 4.
- [x] **Cache lifecycle + error state** (Session 4): `jsonEntryErrors` memoizes a failed load (no
      refetch-on-remount loop; the field renders an error, not a forever-spinner) and
      `staleJsonEntries` invalidates loaded entries on publish / `/sources/~` refresh. The stale flag
      is cleared when a request STARTS, so an invalidation that lands mid-flight wins over the
      in-flight response. `retryJsonEntry` / `ensureJsonEntry` added.
- [ ] **Verify** (Studio running) — **NOT YET RUN**. Walkthrough:
  - **V1** open the router module → both keys listed, **zero** `/api/val/json` requests.
    ⚠️ **SUPERSEDED by Phase 6**: once the list view loads previews for visible rows, opening a module
    legitimately requests the visible window. Verify V16 instead (bounded by visible + overscan, never
    by total key count). "Zero on open" only holds while the list renders no per-entry preview.
  - **V2** open an entry → exactly one `/json`; revisiting it → no new request.
  - **V3** edit `title`, publish → only `content/faq.val.json` modified, `page.val.ts` untouched, and
    the new title **survives the publish without a reload**.
  - **V4** add `/support/new-page` → new `page/support/new-page.val.json` = `{"title":"","body":"","order":0}`
    (from `emptyOf`) + a `c.json` thunk in `page.val.ts`.
  - **V5** hand-authored `content/` and generated `page/support/` coexist; re-editing an existing
    entry still writes its original path.
  - **V6** rename → new file with the same content, old file deleted, thunk key + import path swapped.
  - **V7** delete → file deleted, thunk gone (empty dirs are left behind; `deleteFile` doesn't prune).
  - **V8** corrupt a `*.val.json` → `/json` 500s → ONE request, an error in the field, no refetch on
    navigate-away-and-back; restoring the file + a refresh clears the memo.
  - **V9** a nested `.jsonValues()` module → Studio refuses to load, naming the module.

## Phase 4 — Runtime APIs (`packages/next`, `packages/react`)

- [x] `rsc/initValRsc.ts`: `fetchValKey` (`initFetchValKeyStega`, returned as `fetchValKeyStega`).
- [x] `client/initValClient.ts`: `useValKey` (`useValKeyStega`, promise cache + `React.use`).
- [x] `fetchValRoute` / `useValRoute`: jsonValues-aware. When the module schema is a `.jsonValues()`
      record (`isJsonValuesRecordSchema` in `routeFromVal.ts`), map params → the entry key via
      `getValRouteUrlFromVal` (passing the LOCAL source markers as the guard `val`), then load ONLY
      that entry (RSC: `loadJsonEntryContent`; client: same `React.use` + `jsonEntryPromiseCache` as
      `useValKey`). Non-jsonValues routers keep the eager `fetchVal`/`useValStega` path. Return types
      gained a `NonNullable<S>[string] extends JsonSource<infer C> ? C | null : …` branch. ✅
- [x] Example wires `fetchValRoute` (support pages) — `next build` green; `/support/[slug]` is a
      single-entry dynamic route. (Was `fetchValKey`.) ✅
- [x] **Edit tags for jsonValues entries** (2026-07-28). `stegaEncode` seeds its recursion only from
      the selector branch, so calling it on an entry's RAW content (plain JSON, no `Path`/`GetSchema`
      symbols) left `recOpts` undefined and every string hit the `!recOpts` bail — all four jsonValues
      call sites were **silent identity transforms**, i.e. entries had no click-to-edit at all.
      `stegaEncode` now takes `root?: {path, schema}`; `getJsonEntryStegaRoot` (in `routeFromVal.ts`)
      builds it from `Internal.createValPathOfItem(modulePath, key)` + the serialized `item` schema, so
      a field is tagged `…?p="/support/faq"."title"` — the shape `findUnloadedJsonEntryKey` walks.
      Also needs `SET_AUTO_TAG_JSX_ENABLED(true)`, which only `initFetchValStega` used to call.
      **Not** a sub-selector: `newSelectorProxy` isn't exported from core, it needs the private
      `RecordSchema["item"]` instance, and re-entering the selector branch makes `getModuleIds` report
      the sub-path as a module id. ✅
- [x] RSC draft path (2026-07-28): `fetchValKey` + the jsonValues branch of `fetchValRoute` read
      through the in-process `/json` (`loadDraftJsonEntry`) when enabled, falling back to the local
      committed thunk. `initFetchValKeyStega` now takes `valServerPromise` + `getCookies`. ✅
- [ ] **Client hooks draft path**: `useValKey`/`useValRoute` have the stega tags but still render
      COMMITTED content in draft mode — the same limitation `useValStega` has today. The blocker is
      that `overlayEmitter` is handed the raw `/sources/~` module (`apply_patches:false`, json entries
      still markers), so reading `valOverlayContext.store` would be a no-op. Fixing that means
      emitting `getPatchedSource(...)` (ideally from `invalidateSource`, the single choke point) and
      having the overlay's engine proactively `requestJsonEntry` for entries that have drafts. That
      changes `useValStega` behaviour for ALL client components, so it wants its own change.
- [ ] Draft-added routes are not reachable via `fetchValRoute` (params → key is resolved from the
      LOCAL source), and draft-removed routes still route, then 404 → `null`. Revisit by resolving the
      key set from `/sources/~` now that `getSources` keeps it correct for drafts.

## Phase 5 — Example + CI gate

- [x] Add a `.jsonValues()` router to `examples/next` with a few `*.val.json` entries
      (`app/support/[slug]/page.val.ts` + `content/*.val.json`); consumed via `fetchValRoute`.
- [x] `cd examples/next && pnpm run build` green (`/support/[slug]` dynamic route builds).
- [x] Full CI in one pass — DONE (2026-08-04), all six jobs green: `pnpm run lint`; `pnpm -w run format`
      (only the untracked `.claude/settings.local.json` warns, which CI never sees); recursive typecheck;
      `pnpm test` (1147); `pnpm run build` (root preconstruct + ui, ~6min — `pnpm preconstruct dev` must be
      run after, from the REPO ROOT, since inside `examples/next` it fails with "no entrypoints"); and
      `cd examples/next && pnpm run build`.
      **The `packages/cli` chokidar typecheck failure this file has called "pre-existing" since session 1
      was a stale local install, not a code problem** — `pnpm install --frozen-lockfile` linked
      `chokidar@5` and `-r typecheck` is now clean across every package, examples included. Do not treat
      it as expected any more.

## Phase 6 — Reference integrity + search over un-loaded entries — CODE COMPLETE (manual verify left)

### The defect (found 2026-07-30, reviewing PR #453)

Four client-side global scans are blind to un-loaded entry content:

| Scan                                                                                   | Marker handling                                                                                              | Backs                              |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| [getRouteReferences.ts:31](../../packages/ui/spa/components/getRouteReferences.ts#L31) | `isJson` → `return`                                                                                          | route refs                         |
| [traverseSchemas.ts:38](../../packages/ui/spa/components/traverseSchemas.ts#L38)       | `isJson` → `return`                                                                                          | `getKeysOf` + `getReferencedFiles` |
| [traverseSchemaSource.ts](../../packages/ui/spa/utils/traverseSchemaSource.ts)         | **none** — marker hits the object/record branch, `_type` matches no sub-schema, `continue` ⇒ indexes nothing | the LIVE search worker             |
| [createSearchIndex.ts:25](../../packages/ui/spa/search/createSearchIndex.ts#L25)       | `isJson` → `return`                                                                                          | **nothing — file is DEAD**         |

Why it is not cosmetic: route refs and keyOf refs merge into `allRefs`
([ArrayAndRecordTools.tsx:120](../../packages/ui/spa/components/ArrayAndRecordTools.tsx#L120)), which feeds
two mutating decisions — `refs.length > 0` is the ONLY thing that turns `DeleteRecordPopover` into
"Cannot delete", and `existingKeys` is the list of referring fields `ChangeRecordPopover` rewrites on
rename. A missed ref ⇒ delete looks safe (dangling ref left behind) / rename silently leaves the
referrer pointing at a key that no longer exists. Worse, the answer depends on which entries the user
happened to open this session, so it is nondeterministic.

`traverseSchemaSource`'s accidental skip has one edge: an entry schema with a field literally named
`_type` or `patch_id` would index the marker's own value.

### Scoping rule — direction decides (LOCKED 2026-07-30)

The serialized schema names the target module for 2 of the 3 ref kinds:

| Ref kind   | Matcher                                                           | Names target module?                                                  |
| ---------- | ----------------------------------------------------------------- | --------------------------------------------------------------------- |
| `keyOf`    | `schema.path === parentSourcePath` (`SerializedKeyOfSchema.path`) | **yes**                                                               |
| image/file | `schema.referencedModule === parent`                              | **yes**                                                               |
| `route`    | `source === routeKey` (plain string compare)                      | **no** — `SerializedRouteSchema` only carries include/exclude regexes |

Therefore:

- **Incoming refs → keys only, ZERO loading.** Renaming/deleting key `K` of a jsonValues record `M`:
  the referrers are `keyOf(M)` / `route` fields _elsewhere_, and `M`'s own key set is fully present in
  the base source (markers preserve keys). `M`'s entry CONTENT is irrelevant to finding them. The one
  entry we do need is the one being moved — already handled by the `ensureJsonEntry` await in
  `ChangeRecordPopover`. One entry, not all.
- **Outgoing refs → the only case that needs content.** Loading is required only when a jsonValues
  entry's own schema can contain a referrer to the thing being edited, e.g.
  `s.record(s.object({ test: s.keyOf(otherModule) })).jsonValues()`.
- **The predicate** (schemas only — no sources, no fetching): for a query "refs to `M`", the set to
  load = every jsonValues record whose **item schema transitively contains** (through
  object/array/record/union) a `keyOf` with `path === M`, or an image/file with
  `referencedModule === M`. In the overwhelmingly common case the set is EMPTY: no requests, no
  progress UI, guard complete and correct immediately. Self-reference falls out for free.
- **Route refs are the one over-approximation**: since `s.route()` does not record which router it
  points into, the predicate degrades to "does this jsonValues item schema contain ANY `route` field".
  Still a large cut. Optional later narrowing: test the field's `options.include` regex against the
  route key being renamed and skip fields that cannot match.
- **Search cannot be scoped** — it indexes all content by definition. It is the one unconditional
  full-load consumer, which is why it (and only it) needs pagination + visible progress.

### Third consumer: the record LIST view — visible rows only (added 2026-07-30)

The list view already renders a per-entry preview for EVERY key, unvirtualized:
[RecordFields.tsx:162](../../packages/ui/spa/components/fields/RecordFields.tsx#L162) (default grid) and
[:191](../../packages/ui/spa/components/fields/RecordFields.tsx#L191) (`ListRecordRenderComponent`), both
`<PreviewWithRender path={sourcePathOfItem(path, key)} />`. For a jsonValues record that preview reads
the entry path, i.e. an un-loaded marker — so **today a jsonValues record list shows N broken/empty
previews**, and the naive fix (load what the preview needs) would load every entry on open, defeating
the whole feature.

**Requirement (LOCKED 2026-07-30):** the list must be virtualized with `@tanstack/react-virtual`
(already a dependency — used in `FileGalleryListView` / `MediaPicker`, not yet in record lists) and
entry content loaded **only for the rows the virtualizer actually renders** (visible + overscan).

- The virtualizer's rendered window IS the key window → **one batch request per window**, not one per
  row. This is the strongest argument for the `keys` batch param.
- Debounce on scroll and drop stale windows: flinging through 10k rows must not enqueue 10k keys.
  Requests already in flight for keys that scrolled out are harmless (they fill the cache) but must
  not block newer windows.
- Rows whose content is not loaded yet render a skeleton/spinner, NOT an error — an un-loaded marker in
  a read/render path is normal (see the watch-list note).
- **This changes V1.** "Open the module → zero `/json` requests" is no longer the invariant, because the
  visible rows now load. The new invariant: requests are bounded by (visible + overscan) and by the
  batch chunk size — never by the record's total key count.
- The list shares the SAME `jsonEntryContents` cache, so scrolling warms it for later ref scans. It must
  NOT be mistaken for completeness: the refs guard still runs its own `ensureJsonEntries` for the
  modules the predicate names.
- **`.render()` list layouts for jsonValues records** — now its own work item + step below (was a
  deferred note). `RecordSchema.executeRender` returns `{}` when `isJsonValues`
  ([record.ts:795](../../packages/core/src/schema/record.ts#L795)), so BOTH the per-entry renders and the
  record-level `ListRecordRender` are dropped for these records (the early return precedes the
  `renderInput` block).

### Order of work (decided 2026-07-30)

The list view comes early — it is the most user-visible breakage (a jsonValues record shows N broken
previews today) and it exercises the batch path under real scroll load before anything subtle depends
on it. Steps 1–2 are the only hard prerequisites; 4–6 are independent of each other after that.

1. ✅ **Batch transport** (2026-07-31) — `ValOps.getJsonEntries` + `/json` batch mode + `ApiRoutes` zod.
2. ✅ **Engine primitives** (2026-07-31) — `requestJsonEntries` + `ensureJsonEntries` + progress store,
   `markAllJsonEntriesStale` batched.
3. ✅ **List view** (2026-07-31) — virtualized `RecordFields` (both branches) with
   `@tanstack/react-virtual`, loads the rendered window via `requestJsonEntries`, skeletons for un-loaded
   rows. Also fixed the N-requests-on-open storm it exposed, by coalescing at the engine level. → **V16**
   still to run manually.
4. ✅ **Predicate** (2026-07-31) — `jsonValuesLoadRequirements` + 9 unit tests. Pays off in step 5.
5. ✅ **Ref hooks + popover gating** (2026-08-04) — the hooks return a `ReferencesResult`, the popovers
   gate on `success`, completeness is read from the engine (`getJsonEntriesLoadStatus`) rather than held
   in component state. → **V10–V13, V17** still to run manually.
6. ✅ **Search** (2026-08-04) — first-query trigger, THROTTLED re-index, `indexVersion` so the query
   re-runs per index, percentage + honest empty state in the dropdown, marker skip in
   `traverseSchemaSource`, dead `createSearchIndex.ts`/`search.test.ts`/`search/index.ts` deleted, and the
   worker's index builder extracted to `search/searchIndex.ts` so it is testable. → **V14** still to run
   manually.
7. **`.render()` list layouts (windowed)** → **Phase 7 stage 1** (client-side schema instances), verified
   by **V18**. Not gated on anything any more; it is simply a different phase's work. Until it lands,
   step 3's skeleton + `<Preview>` fallback IS the list preview.
8. **Verify + gate** — the CI gate is ✅ green (2026-08-04, see Phase 5). The full manual walkthrough
   (V1–V18, noting V1 is superseded; V1–V9 have still never been run) is what remains, and it is the only
   remaining Phase 6 work.

The caching decision (last item below) is deliberately NOT in this order — it is a question for Fredrik,
not a step.

### Work items

- [x] **Batch `/json` (transport)** — DONE (2026-07-31). GET `/json` now takes exactly one of `key`
      (unchanged single-entry shape), `keys` (**repeated** query param, not a JSON array — `ValClient`
      already serialises array query values, and the router's `groupQueryParams` already hands zod a
      `string[]`, so no plumbing was needed), or `offset`+`limit`. Batch responses are
      `{path, entries, missing, errors, total, offset?, limit?}`. `JSON_ENTRIES_BATCH_MAX = 100` is
      exported from `ApiRoutes` so client and server agree; over-cap requests fail zod validation.
      Shape violations are 400s, checked in `ValRouter.test.ts` (+5). `ValidQueryParamTypes` gained
      `number` (the client stringifies query values anyway).
- [x] **Batch `ValOps.getJsonEntries(mfp, {keys | offset+limit}, {applyPatches})`** — DONE (2026-07-31).
      `initSources()` and `fetchPatches()` are hoisted out of the per-entry loop (pinned by a test that
      asserts `fetchPatches` is called exactly once for a 2-key batch); thunks resolve via `Promise.all`.
      `getJsonEntry` is now a one-key wrapper over it, so there is a single code path. Per-entry problems
      stay per-entry: an unknown key lands in `missing`, a corrupt `*.val.json` in `errors`, and only a
      missing/non-record MODULE is a whole-request `not-found`. `offset`/`limit` REQUIRES
      `applyPatches:false` and errors otherwise — enumerating from the base source would silently omit
      draft-added keys, which is the exact bug class this phase exists to kill. Tests: +9 in
      `ValOpsFS.jsonValues.test.ts`.
- [x] **`jsonValuesLoadRequirements(schemas, query)`** — DONE (2026-07-31).
      `components/jsonValuesLoadRequirements.ts`: pure, schemas-only, no sources and no fetching. `query`
      is `{kind:"keyOf"|"file", module}` or `{kind:"route"}`; returns the `ModuleFilePath[]` whose entries
      must be loaded. Only modules whose ROOT is a `.jsonValues()` record are candidates (root-only,
      locked decision #7), and their `item` schema is walked through object/array/record/union.
      An unknown schema type returns TRUE (conservative): wrongly reporting "nothing to load" is exactly
      how a guard starts lying. `keyOf.path` (branded `SourcePath`) and the query's `ModuleFilePath` are
      compared as plain strings through a helper, so no type assertion is needed.
      Tests (+9): empty for the incoming-ref case, empty for a `keyOf` at a different module, empty for
      the same shape WITHOUT `.jsonValues()`, non-empty through array/nested-record/tagged-union/deep
      nesting, self-reference, file refs matched by `referencedModule` (and not satisfied by a `keyOf`
      query), the `route` over-approximation both ways, and multiple modules reported.
- [x] **`ValSyncEngine.ensureJsonEntries(moduleFilePaths)`** — DONE (2026-07-31). Awaitable,
      whole-module, and it returns `{complete, errors}` rather than plain `void`: a guard that gates a
      delete must be able to tell "loaded everything" from "some entry failed", which is the entire
      point. Runs up to 3 passes, because an invalidation landing mid-flight re-marks entries stale and
      reporting `complete` while holding pre-invalidation content would be the same lie in a new place.
      Never called on boot.
- [x] **Progress store** — DONE (2026-07-31). `{status, loaded, total, percentage}` via
      `subscribe("json-entries-progress")` + `getJsonEntriesProgressSnapshot()`. Counts the whole RUN
      across modules and batches (not per module) so a percentage never resets at a module boundary;
      resets to zero once nothing is in flight. `loaded` counts resolved keys — loaded, missing AND
      failed — so a failing entry cannot stall the bar at 99%. The single-entry `ensureJsonEntry` counts
      into the same run, so one indicator covers an opened entry and a loading list.
- [x] **`ValSyncEngine.requestJsonEntries(mfp, keys)`** — DONE (2026-07-31). Fire-and-forget window
      loader; both public methods delegate to one private `loadJsonEntries` (filter → chunk at 50 →
      `loadJsonEntryChunk`), so there is a single cache/in-flight/emit path. Skips
      cached/in-flight/errored keys, so re-rendering the same window costs nothing, and **skips keys that
      exist only in a pending patch** — they have no committed content, so requesting them would 404 and
      wrongly mark the row errored (their value comes from the patch, via `getPatchedSource`). One
      `invalidateSource` per batch rather than per entry.
- [x] **Coalesce single-entry requests** — DONE (2026-07-31), and it turned out to be the actual bug.
      Each row's `<Preview>` resolves its own path, and `useSchemaAtPathInternal` fires
      `requestJsonEntry` for any un-loaded marker it walks into — so opening a jsonValues record with N
      entries fired **N `/json` requests** (the symptom is a wall of spinners, but the cause is a request
      storm, not a rendering bug). `requestJsonEntry`/`requestJsonEntries` now queue into
      `pendingJsonEntryRequests` and flush on a microtask, so one render pass costs ONE request per
      module. The single-entry fetch path was deleted: `ensureJsonEntry` now delegates to the same
      `loadJsonEntriesSettled`, so there is one fetch path (and the Studio no longer uses `/json?key=`
      at all — only the RSC runtime does).
- [x] **Virtualize the record list + load visible rows only** — DONE (2026-07-31). New
      `VirtualizedRecordList` wraps both branches of `RecordFields` (default cards + the
      `.render()` list), requests the rendered window via `requestJsonEntries`, and depends on the
      window's CONTENT (not the array identity — `Object.keys` returns a fresh array each render, which
      would re-fire the effect on every render of a long list). Records at or below
      `VIRTUALIZE_THRESHOLD = 50` keys render plainly as before — a nested scroll container is a real UX
      change and is not worth imposing on the ordinary small record — and that threshold also bounds the
      un-virtualized load to one or two batches. Non-jsonValues records virtualize through the same path.
- [x] **Skeletons for un-loaded jsonValues rows** — DONE (2026-07-31). `RecordRowSkeleton` (fixed
      height, so the virtualizer's measurements do not jump as content lands) replaces the preview when
      the key's value in the patched source is still a marker; `useUnloadedJsonEntryKeys` computes that
      set ONCE per list rather than subscribing per row.
      **Still open**: (c) from the original item — a per-row retry affordance for the `errored` case.
      A failed row currently falls through to `<Preview>`, which renders the existing error state.
- [ ] **`.render()` list layouts for jsonValues records (windowed)** — **moved to Phase 7 stage 1**; it is
      a client-side-instance change, not a transport one. Summary: replace the `isJsonValues` early return
      in `RecordSchema.executeRender` with a per-key `isJson(itemSrc) → continue`, then call
      `executeRender(mfp, patchedSource)` on the CLIENT instance. Because `executeRender` iterates
      `Object.entries(src)` and un-loaded entries are still markers, the resulting
      `ListRecordRender.items` ([render.ts:9](../../packages/core/src/render.ts#L9)) is naturally
      **partial** — exactly the loaded keys — and `resolveRefPreview`'s keyed lookup
      ([useRefPreview.ts:82](../../packages/ui/spa/components/useRefPreview.ts#L82)) misses on the rest,
      which the skeleton item above turns into a skeleton. No `render` field on `/json`, no pagination in
      the render path. (Earlier draft of this item assumed only the server could run `select`; wrong — see
      Phase 7.)
- [x] **Ref hooks stop lying** — DONE (2026-08-04). `useEagerRouteReferences` / `useKeysOf` /
      `useReferencedFiles` return a `ReferencesResult` (`loading` + percentage / `success` / `error` +
      `retry`) instead of a bare array; `refs` is populated in every state (a ref that IS found is real)
      but only `success` means COMPLETE. All three delegate to the new
      `useReferenceScanStatus(query)` (`components/useReferenceScanStatus.ts`), which runs
      `jsonValuesLoadRequirements` first: empty ⇒ `success` on the first render, no request, no effect.
      Non-empty ⇒ an effect calls `ensureJsonEntries` and the percentage comes off the progress store
      (0 while the run has not started — an idle store reports 100, which would read as done).
      `mergeReferences` combines the keyOf and route scans for a router item: refs are the union, the
      status is the WORSE of the two, since one incomplete scan makes the union incomplete.
- [x] **Engine: `getJsonEntriesLoadStatus(mfps)` + `retryJsonEntries(mfps)`** — DONE (2026-08-04).
      Completeness is read from the engine on every render instead of being held in component state: a
      held copy goes stale the moment a publish invalidates an entry, which is the defect again in a new
      place. `error` outranks `incomplete` (a failed entry cannot be waited out), and an entry whose
      refetch is IN FLIGHT counts as incomplete — the refetch clears the stale flag when it STARTS, so
      "not stale" alone would read as complete while pre-publish content is still in hand (V15).
      `retryJsonEntries` clears the whole module's memoized failures and reloads, because without that
      `ensureJsonEntries` skips failed keys forever (by design — that memo is what stops the refetch
      loop).
- [x] **Popovers gate on completeness** — DONE (2026-08-04). `DeleteRecordPopover` shows "Checking
      references (N%)" while loading and a blocked "Cannot delete" + `Try again` on error;
      `ChangeRecordPopover` replaces the rename FORM with the same two states, so there is nothing to
      submit, and `onSubmit` re-checks the status as defense in depth. Both take a `ReferencesResult`
      (prop `references`) instead of `refs`/`existingKeys`, so a caller cannot pass a status that
      disagrees with the refs. Found refs still win: `refs.length > 0` renders "Cannot delete" whatever
      the status, because a ref that was found is real. `FilePropertiesModal`'s delete is disabled unless
      the scan reports `success`, with the reason in its tooltip.
- [x] **Search** — DONE (2026-08-04). `useAllJsonValuesLoad(enabled)` (same file, same machinery as the
      refs guard) loads EVERY jsonValues module — the one consumer the scoping rule cannot help — and
      `enabled` is the first non-empty query, NOT `SearchField` mount / dialog open (radix mounts the
      content when the dialog opens, so a mount-effect trigger would load on open). The index rebuild is
      **throttled at 300ms** rather than debounced: a debounce postpones every rebuild until the load goes
      quiet, which defeats partial results; a throttle rebuilds at most every 300ms AND at least every
      300ms while batches keep landing. `useSearchWorker` gained `indexVersion` (bumped per completed
      build) so the query is re-run against each new index — without it, results are frozen at whatever
      was indexed when the query was typed.
- [x] **Search shows partial results + a percentage while loading** — DONE (2026-08-04). Results appear
      immediately from whatever is indexed; `SearchResultsList` takes the `JsonValuesLoadStatus` and
      renders "Searching… N% indexed" off the progress store (whole requested set, so it does not reset at
      module boundaries), suppresses **"No results found" while the index is still filling** — it would be
      a lie — and states plainly that results may be incomplete if the load failed.
      **Accepted limitation**: FlexSearch re-ranks on each new index, so a late batch can reorder the
      visible list, not just append to it. Fixing that means holding a stable order client-side; not worth
      it until someone notices.
- [x] **Fix the live search traversal** — DONE (2026-08-04). `traverseSchemaSource` skips
      `{_type:"json"}` markers. This was not merely cosmetic: the marker fell through to whichever branch
      its ITEM schema selected, so a record/object item walked the MARKER's own keys and indexed
      `_type: "json"` as content. Pinned by a test that fails without the skip.
- [x] **Delete the dead `createSearchIndex.ts` + `search.test.ts`** — DONE (2026-08-04), plus
      `search/index.ts` (its `search()` helper had no caller outside the deleted test). Their coverage was
      of unreachable code; the LIVE path had none, so `buildIndex`/`performSearch` moved out of
      `search.worker.ts` into `search/searchIndex.ts` (the worker module runs `self.onmessage` on import
      and cannot be imported by a test) and `search/searchIndex.test.ts` now covers the real indexer,
      including partially-loaded jsonValues records. Also dropped a stray per-node `console.log` from the
      path-cleaning helper.
- [x] **Fold `markAllJsonEntriesStale` into the batch path** — DONE (2026-07-31).
      `markJsonEntriesStale` now marks the module's loaded keys stale and hands them to
      `requestJsonEntries` in one call, so a publish with hundreds of cached entries is one batch per
      module instead of one request per entry (pinned by a test that counts batches AND per-key
      requests). It feeds the same progress store, so the post-publish refresh is visible.
      The refs guard re-enters `loading` on that refresh as of step 5 — `getJsonEntriesLoadStatus`
      counts stale AND in-flight entries as incomplete. The search index re-enters `loading` too, as of
      step 6 (it reads the same status, and its throttled rebuild picks the refreshed content up).
      **Still open**: the entry detail view.
- [ ] **Verify** (Studio running):
  - **V10** rename/delete a key in a jsonValues router while another ORDINARY module holds a
    `keyOf`/`route` ref to it → refs found, delete blocked, rename rewrites the referrer, and **zero**
    `/json` requests (incoming-ref case).
  - **V11** same, but the referrer lives inside a jsonValues entry (`keyOf` in the item schema) →
    progress shown, refs found after load, delete blocked, rename rewrites it.
  - **V12** delete a key in an ordinary record while no jsonValues item schema references it → zero
    `/json` requests, guard instant.
  - **V13** a batch load that fails mid-way → guard shows an error + retry, destructive action stays
    blocked (never silently "no refs").
  - **V14** open search, type nothing → zero `/json`. Type a query → matches from already-indexed
    content appear IMMEDIATELY (not after the load), the dropdown shows a percentage that climbs to
    100%, entry content becomes findable as batches land, and the index is NOT rebuilt once per batch.
  - **V15** publish with many entries cached → one batched refresh (not N requests), progress visible,
    no stale answers from the refs guard in between.
  - **V16** open a jsonValues record with many entries → only the visible window (+ overscan) is
    requested, in ONE batch, and those rows show real previews; rows below the fold show skeletons and
    have NOT been requested. Scroll slowly → one batch per window. Fling to the bottom → the number of
    requests is bounded by windows actually rendered, never by total keys.
  - **V17** scroll a jsonValues list to the bottom, then rename a key whose only referrer is an entry
    that was scrolled past → the refs guard still reports COMPLETE (cache warm ⇒ instant) and the
    rename rewrites the referrer.
  - **V18** (Phase 7 stage 1) a jsonValues record WITH `.render({layout:"list"})` → visible rows show the
    user's title/subtitle/image; rows below the fold are skeletons of the same height (no measurement
    jump, no marker reaching a preview component); scrolling fills them in. Then edit a visible row's
    title WITHOUT publishing → the row updates as you type (the render is computed from the patched
    source on the client).

### Review findings (self-review of steps 5–6, 2026-08-04)

Found and fixed in the pass:

- **A nullable jsonValues record would have frozen every guard.** `getJsonEntriesLoadStatus` treated
  "the module's source is not a record to enumerate" as incomplete, which is right for a source that has
  not synced but wrong for a `.jsonValues().nullable()` record whose value IS `null` — there is nothing to
  load, so the guard could never reach `success` and the delete/rename popover would sit at "Checking
  references" forever. Now split: source absent from `serverSources` ⇒ incomplete, source present but not
  a record ⇒ contributes nothing. Both branches pinned by tests.
- **A retry that looked dead.** `retryJsonEntry`/`retryJsonEntries` cleared the memoized failure without
  emitting, so nothing re-rendered until the request settled — and if the reload had nothing to fetch (an
  entry can hold both content and a failed refetch), nothing re-rendered at all. Both now invalidate the
  module.
- **A dead "Try again" button.** When the SCHEMAS fail there is nothing the hook can retry, so `retry` is
  now optional on the error variant and the popovers only render the button when it exists.
- Cosmetic: the extracted search function was named `searchIndex` with a parameter of the same name
  shadowing it; renamed to `performSearch` (its original name in the worker).

Considered and deliberately NOT changed:

- **`getJsonEntriesLoadStatus` runs on every render** and is O(entries) with an allocation. Memoizing it
  on `[sources, progress]` would be correct in every case we could name, but not obviously in all of them
  (stale-marking without a request, in-flight transitions), and the hooks that call it already run
  `getKeysOf`/`getRouteReferences` — full traversals of EVERY module's source — on the same renders. Not
  worth trading correctness margin for a cost that is already dominated.

### Review findings (self-review of steps 1–3, 2026-07-31; revisited 2026-08-04)

Two issues were found and fixed during the pass (a missing React `key` in the un-virtualized branch,
and an effect that re-fired on every render because `Object.keys` returns a fresh array). The failed-row
and 3-pass-logging items were closed on 2026-08-04 with steps 5–6. What is left:

- [ ] **DECISION NEEDED — ask Fredrik: no component tests anywhere in the SPA.** The jest preset is
      `testEnvironment: "node"` and `jest-environment-jsdom` is not installed, so nothing in the repo
      renders React. That now leaves a growing amount of Phase 6 logic covered only by the manual
      walkthrough: `VirtualizedRecordList` (window → `requestJsonEntries`, skeleton/error row swap, V16),
      the ref hooks' status plumbing and the popover gating (V10–V13), and search's lazy trigger +
      throttled re-index (V14). Adding a jsdom project to the preset is one devDependency
      (`@testing-library/react` IS already a devDependency of `packages/ui`) plus a jest projects config —
      a CI-affecting change, hence a decision rather than a task. The alternative is to accept manual-only
      and say so here.
- [ ] **Nested scroll container needs a real look (V16)** — the virtualized branch introduces an
      `overflow-auto` viewport capped at `VIEWPORT_MAX_HEIGHT = 800`, inside the Studio's own scroll
      container. Two things to check on a real screen: that scroll chaining feels right (the inner
      scroller should not trap the page), and that 800px is not taller than a small viewport. A
      `max-h-[70vh]`-style cap may be better than a fixed pixel height.
- [ ] **Row-height estimates are guesses** — `CARD_ROW_HEIGHT = 186` / `RENDER_ROW_HEIGHT = 104` were
      derived from the card's `max-h-[170px]` + padding, not measured. `measureElement` corrects the real
      heights, so the estimate only affects the initial scrollbar and the first window's size; still
      worth checking against V16 so the first window is not visibly wrong.
- [x] **Skeleton has no retry affordance** — DONE (2026-08-04), and the original note UNDERSTATED it: a
      failed row does NOT fall through to `<Preview>`. Its value is still a marker, so
      `useUnloadedJsonEntryKeys` counted it as un-loaded and it pulsed as a skeleton forever (the failure
      is memoized, so nothing ever refetched it). That hook is now `useJsonEntryRowStates`, which splits
      un-loaded from FAILED (reading `getJsonEntryError`), and a failed row renders `RecordRowError` —
      key, message and a `Try again` calling `retryJsonEntry`. It replaces the whole row rather than
      sitting inside it, because the row is click-to-navigate and there is nothing to navigate to (and
      the `.render()` branch's row is a `<button>`, which must not contain another button).
- [x] **`loadJsonEntriesSettled`'s 3-pass bound is arbitrary** — DONE (2026-08-04). Still a backstop, but
      exhausting it now logs the outstanding requests (`JSON_ENTRIES_MAX_LOAD_PASSES`), and that path
      returns `complete: false` explicitly instead of falling through to "no errors, so complete".
- [ ] **The un-virtualized path requests up to 50 keys on mount** — for a jsonValues record of 50
      entries, opening it loads all 50 (one batch). That is a deliberate trade (see
      `VIRTUALIZE_THRESHOLD`) but it does mean "zero requests on open" is never true for small
      jsonValues records. Revisit if a 50-entry record's previews prove expensive to load.
- [ ] **Progress `percentage` is 100 when idle** — so a consumer that renders it without checking
      `status` first shows "100%" before anything starts. Documented on the type; a `null` percentage
      while idle would be harder to misuse.
- [ ] **DECISION NEEDED — ask Fredrik: efficient browser caching for `/json`.** Deferred from the
      Phase 6 design round (2026-07-30). Fredrik's idea: in **http/prod mode there is a stable commit**,
      so put it in the request and make the response immutably cacheable by the browser. Open parts:
      (1) FS/dev mode has no commit — what is the key there, or do we simply not cache?
      (2) `ValClient` sets its own headers, exposes no response headers, and zod-validates a JSON body,
      so `ETag`/`If-None-Match`/304 is NOT reachable without extending that layer
      ([ValClient.ts:88](../../packages/shared/src/internal/ValClient.ts#L88)).
      (3) `apply_patches:false` (what the Studio sends) is a pure function of committed files, so it is
      the cacheable case; `apply_patches:true` is mutable.
      (4) Alternative if headers stay off-limits: in-payload conditional loading (client sends known
      version tokens, server replies "unchanged") — needs a per-entry version token, and
      `jsonValuesSha.ts` was deliberately deleted (locked decision #3), so there is none today.
      Until this is decided, "caching" means only: the client never refetches what is in
      `jsonEntryContents`, and the server hoists `initSources`/`fetchPatches` per batch.

**Longer-term alternative (not now):** a server-side reference-scan endpoint ("which source paths hold
`keyOf`/`route` value X"), which the server can answer from the `*.val.json` files on disk with no
client download at all. Phase 6 keeps the scan client-side; the schema predicate is what makes that
affordable. Revisit if the outgoing-ref case (V11) turns out to be common in real projects.

## Phase 7 — Use the CLIENT-SIDE schema instances (added 2026-07-31)

### The realisation

The SPA already has the user's REAL schema instances and has been throwing them away.
`<ValModulesClient>` registers the registry on `window.__VAL_MODULES__`
([ValModulesClient.tsx:27](../../packages/next/src/ValModulesClient.tsx#L27)), `useValModules` reads it
([hooks/useValModules.ts](../../packages/ui/spa/hooks/useValModules.ts)), `ValProvider` pushes it into
`syncEngine.setValModules`, and `extractValModules` returns BOTH
`schemas: Record<ModuleFilePath, Schema<…>>` (instances) and `serializedSchemas`
([extractValModules.ts:113](../../packages/core/src/extractValModules.ts#L113)) — but `setValModules`
keeps only the serialized ones. Everything downstream then re-derives a lobotomised schema with
`deserializeSchema`, which drops (a) the render `select`, (b) `customValidateFunctions` (every case passes
`[]`), and (c) the router. Cross-bundle identity is already handled: the identity symbols use
`Symbol.for` so the SPA's copy of core and the host bundle's copy agree
([selector/index.ts:57](../../packages/core/src/selector/index.ts#L57)), and protected methods are called
by bracket access (`schema["executeSerialize"]()`) precisely because `instanceof` is unreliable across
copies. So: keep the instances and use them.

Availability caveat: instances exist only when the host app renders `<ValModulesClient>`. Without it
`window.__VAL_MODULES__` is undefined, `setValModules(null)` runs, and everything must fall back to
today's serialized behaviour. `localModulesStatus` (`absent`/`loading`/`error`/`loaded`) is the flag.

### Stage 1 — renders from instances (absorbs Phase 6 step 7) → **V18**

- [ ] Retain `extracted.schemas` on the engine as `localSchemaInstances`.
- [ ] Core: replace the `isJsonValues` early return in `RecordSchema.executeRender`
      ([record.ts:795](../../packages/core/src/schema/record.ts#L795)) with a per-key
      `isJson(itemSrc) → continue`, so a partially-substituted record renders its loaded keys.
- [ ] Engine `computeRender(mfp)` = `instance["executeRender"](mfp, patchedSource)` → the existing
      `renders` map + `invalidateRenders`; memoized per (module, sourceSha); recomputed on source
      invalidation. Wrap each key's `select` in try/catch so one throwing user function is one error row,
      not a dead Studio.
- [ ] Windowing is free: un-loaded entries are markers, markers are skipped, `items` comes out partial,
      `resolveRefPreview` misses → skeleton (Phase 6).
- What this buys beyond jsonValues: renders work again for ALL schema types (they are dead Studio-wide
  today) and they are computed from the PATCHED source, so a row's title updates as the user types —
  something the server path could never do.

### Stage 2 — custom validators, worker kept (LOCKED 2026-07-31)

The worker stays. `executeCustomValidateFunctions` only ever APPENDS errors
([schema/index.ts:91](../../packages/core/src/schema/index.ts#L91)) and `CustomValidateFunction` is
`(src, ctx:{path}) => false | string` — pure, per-node — so custom errors can be merged AFTER the
worker's structural result. No synchronous worker→main round trip is needed.

- [ ] **Gate**: one boolean per module, memoized by `schemaSha` — does the serialized tree contain any
      `customValidate: true`? If not (the common case) nothing changes: no extra message, no main-thread
      work. Only modules that actually declare a custom validator pay anything.
- [ ] **Worker reports WHERE**: while it has the module, the worker walks (serialized schema, source) and
      collects the paths of flagged nodes it actually visited (so unions/optional branches only report
      paths that exist). Response grows `customValidatePaths`. This walk must be separate from
      `executeValidate` — the deserialized schema has no validators, so it cannot report that it skipped
      any. Walking stays off the main thread; the main thread only EXECUTES.
- [ ] **Main thread executes, time-sliced**: per path, `Internal.resolvePath(modulePath, source, instance)`
      (already generic over `Schema | SerializedSchema`,
      [module.ts:279](../../packages/core/src/module.ts#L279)) → node instance + src, then run that node's
      validators. Slice on a ~5ms budget yielding via `scheduler.postTask({priority:"background"})` →
      `requestIdleCallback` → `MessageChannel`. Abort when the module's `latestRequestId` changes
      (`ValidationWorkerClient` already tracks it) or the sourceSha moves.
      A slow user validator still blocks — accepted: devs who write slow validators see their own slowness.
- [ ] **Error store must MERGE, not replace** — structural errors publish immediately (fast feedback),
      custom errors merge per chunk. A wholesale replace would erase the first publish.
- [ ] **API gap**: running one node's validators needs `customValidateFunctions`, which is
      `private readonly` on EACH SUBCLASS, so no base-class helper can reach it. Chosen fix: add a one-line
      `protected executeCustomValidateAt(path, src)` to each schema class (~15 files, mechanical, matches
      the `schema["executeX"]()` convention). Rejected: bracket-accessing a private field from the SPA;
      hoisting the field to the base class (cleanest end state, biggest diff — revisit in stage 3).

**Triggers (LOCKED 2026-07-31)** — custom validation is NOT part of the load path:

- [ ] **On update only**: `addPatch` → `requestModuleValidation(mfp)` runs structural (as today) plus
      custom for THAT module. Note `requestAllModuleValidation()` currently fires from `setValModules`
      ([ValSyncEngine.ts:2631](../../packages/ui/spa/ValSyncEngine.ts#L2631)), i.e. on boot and every HMR —
      structural may keep doing that, custom must not.
- [ ] **Pre-publish**: validate every module touched by patches (the engine already knows the patch set
      per module), custom included, with every needs-keys round resolved before publish is allowed.
- [ ] **"Validate absolutely everything" switch**: one call —
      `validateAll({ custom: true, loadAllJsonEntries: true })` — walks every module, resolves every
      needs-keys round, reports progress through the Phase 6 progress store. For dev/CI/debugging.

**needs-keys protocol for `.jsonValues()` (LOCKED 2026-07-31)**: a custom validator cannot run against
opaque markers, so the call returns what it needs instead of guessing:

```
runCustomValidation(path) →
  | { status: "done", errors }
  | { status: "needs-keys", moduleFilePath, keys: string[] }
```

- [ ] The keys come from the record's MARKER key set in the module source — always present, no loading
      required to compute them. A validator on the RECORD needs every key in its subtree; a validator on
      the ITEM schema needs only that entry's key.
- [ ] The caller resolves them with Phase 6's `ensureJsonEntries` / `requestJsonEntries(mfp, keys)` and
      retries. Guard the loop: if a retry returns the same `needs-keys` set, report an error instead of
      spinning. Validation is thereby the FOURTH consumer of the batch loader (list view, refs guard,
      search, validation).
- [ ] **Cost to document for users**: a custom validator on a `.jsonValues()` RECORD forces a full load of
      that record whenever it runs (on update of that module, or pre-publish). Prefer putting custom
      validators on the ITEM schema, which needs one key. This is inherent, not a bug: a record-level
      validator is by definition a statement about all entries.
- [ ] **The server stays the authority for publish.** Client-side custom validation of a jsonValues module
      is only ever as complete as what is loaded; `validateJsonValuesEntries` on the server validates every
      entry. The client pass is feedback, not proof.
- [ ] **Expect newly-surfaced errors.** Client validation cannot run custom validators AT ALL today, so
      existing projects may light up with errors that were previously invisible — and the publish gate
      reads validation errors ([DraftChanges.tsx:143](../../packages/ui/spa/components/DraftChanges.tsx#L143)),
      so some will block publish. Correct behaviour that will read as a regression; worth a release note.

### Stage 3 — instances become the primary schema source

- [ ] Serialized schemas stay for what genuinely must be JSON: `schemaSha` (the change-detection key
      against the server), patch-op classification, `/sources/~` comparison. Anything needing BEHAVIOUR
      (render, validate, `emptyOf`) reads instances. Honest framing: serialize never fully goes away;
      `deserialize` **on the client** does.
- [ ] Ends with `deserializeSchema` removed from the SPA (the worker keeps it only if stage 2's structural
      pass still runs there — which it does, so this is "removed from the main thread").
- [ ] Consider hoisting `customValidateFunctions` (and the router) to the `Schema` base here, which
      retires the stage-2 per-class helper.

### Stage 4 — delete the server render path for the Studio

- [ ] `getRenders` has exactly ONE caller — `/sources/~`
      ([ValServer.ts:1480](../../packages/server/src/ValServer.ts#L1480)) — and only when
      `apply_patches` is true, which the Studio never sends. Once stage 1 lands that branch is dead for the
      Studio: remove it, and the `render` field on the `/sources/~` response if no other consumer wants it.

---

## sha design — DROPPED (2026-07-02)

The `c.json` sha (a `<schemaHash>-<contentHash>` revalidation-cache key) was **removed** — it wasn't
worth the complexity. `c.json` takes only the thunk; `jsonValuesSha.ts` was deleted. Without a cache
key there is no skip-cache: `validateJsonValuesEntries` validates each loaded entry's content
unconditionally (accepted "validation takes more time" tradeoff).

## Open questions / watch-list

- `JsonOf<T>` correctness vs `resolveJsonModule` inference (esp. images inside json: `_type`
  widens to `string`, so json must NOT keep the literal `"file"` brand — `JsonOf` widens it).
- ~~Does `getSources()`/`deepClone` preserve the `_import` thunk?~~ **Resolved**: `deepClone`
  ([patch/util.ts](packages/core/src/patch/util.ts)) passes functions through unchanged and
  `_import` is enumerable, so base-source thunks survive. Patched/draft json entries become thunkless
  markers (over-the-wire value) → `validateJsonValuesEntries` skips them by design (validated via the
  draft/endpoint path later). So committed validation is correct.
- `vm` loader dynamic `import()` + `.json` resolution.
- resolvePath/selector must never throw on a not-yet-loaded entry.
- **Skipping an un-loaded marker is NOT automatically safe.** It is fine for a read/render path (the
  content is simply not there yet) but WRONG for any scan whose answer gates a mutation — see Phase 6.
  When adding a new traversal, decide explicitly which of the two it is.
- Browser caching of `/json` — deferred; the last Phase 6 item holds the open questions.
- **Does `jsonEntryContents` need eviction?** With visible-row loading, scrolling a 10k-entry list (or
  running search once) eventually caches every entry's content in the client. Nothing evicts today. If
  this bites, an LRU keyed by `mfp\0key` is the obvious answer — but eviction must never silently
  downgrade a refs guard that reported COMPLETE, so the guard needs to re-check (or pin) the keys it
  depended on. Decide only when we see real memory numbers.
- ~~**Where do per-entry renders come from for jsonValues?**~~ **Resolved (2026-07-31)**: from the CLIENT
  schema instances — the SPA already has them via `window.__VAL_MODULES__` and discards them in
  `setValModules`. See Phase 7. (`executeRender` returning `{}` for jsonValues and Studio renders being
  null across the board are both fixed there.)

## Changelog

- **Session 8 (2026-08-04)**: Phase 6 steps 5 and 6 — the last of its code — plus a review pass and the
  CI gate.
  - Step 5: the three ref hooks return a `ReferencesResult` and the destructive popovers gate on
    `success`, not on `refs.length`. Engine gained `getJsonEntriesLoadStatus` (completeness read per
    render, not held in state; `error` outranks `incomplete`; in-flight counts as incomplete) and
    `retryJsonEntries`.
  - Step 6: search loads every jsonValues module on the first non-empty query, shows partial results with
    a percentage, throttles (not debounces) the re-index and re-runs the query per `indexVersion`;
    `traverseSchemaSource` skips markers; the dead `createSearchIndex.ts`/`search.test.ts`/`search/index.ts`
    are gone and the live indexer moved to `search/searchIndex.ts` where it can be tested.
  - Closed two step-1–3 review leftovers: a failed row rendered a skeleton FOREVER (the failure is
    memoized, so nothing refetched it) and now renders an error + `Try again`; exhausting the load-pass
    bound is logged and returns `complete: false` explicitly.
  - Self-review of steps 5–6 caught three real defects, all fixed: a `.jsonValues().nullable()` record
    whose value is `null` would have frozen every guard at "Checking references" forever; a retry that
    emitted nothing looked dead; a "Try again" button with nothing to retry when the schemas fail.
  - CI gate green across all six jobs — and `packages/cli`'s chokidar typecheck failure, called
    "pre-existing" in this file since session 1, was only a stale local install.
  - Tests: +5 (step 5), +5 (step 6), +2 (review) = 1147 total.
- **Session 6 (2026-07-30)**: planning only — NO code. Reviewing PR #453 surfaced the
  reference-integrity defect (the marker skips in `getRouteReferences`/`traverseSchemas` silently make
  the delete gate and rename fixup answer "no references", nondeterministically) and that the live
  search path never handled markers at all while the file that does (`createSearchIndex.ts`) is dead.
  Designed Phase 6: schema-derived scoping rule (direction decides — incoming refs need keys only,
  so the common case loads NOTHING), batch `/json` (`keys` + `offset`/`limit`), a progress store,
  status-returning ref hooks that gate the destructive popovers, lazy search-triggered full load, and
  batched publish invalidation. Browser caching deferred to a decision item at the end of Phase 6.
  Then added the **visible-rows-only list requirement** (Fredrik): the list view already renders a
  per-entry `<Preview>` for every key with no virtualization, so jsonValues records show N broken
  previews AND the naive fix would load everything on open. Virtualize with `@tanstack/react-virtual`
  and request only the rendered window (`requestJsonEntries(mfp, keys)`). Supersedes V1; added V16/V17,
  plus watch-list entries for cache eviction and for `executeRender` returning `{}` on jsonValues.
  Then promoted the deferred render note to real work: an explicit **Order of work** (8 steps, list view
  early because it is the visible breakage), **skeletons on all three preview paths** (a marker must never
  reach a preview component), **windowed `.render()` list layouts** (per-key `render` on the batch
  response + partial `items`; gated on a DECISION about renders being null Studio-wide — `/sources/~` only
  computes them when `apply_patches` is true, and the Studio always sends false), and **search showing
  partial results with a percentage** while the index fills. Added V18.
- **Session 7 (2026-07-31)**: planning — **Phase 7 (client-side schema instances)** added, and Phase 6
  step 7 moved into it. The SPA already has the user's real `Schema` instances via
  `window.__VAL_MODULES__` → `extractValModules().schemas`; `setValModules` discards them and everything
  downstream re-derives a `deserializeSchema` copy with no render `select`, no `customValidateFunctions`
  (every case passes `[]`) and no router. Stage 1 renders from instances (all schema types, computed from
  the PATCHED source, so draft-accurate). Stage 2 keeps the validation WORKER and adds custom validators:
  gate per module on the serialized `customValidate` flag, worker reports the flagged PATHS, main thread
  executes them time-sliced, error store merges instead of replacing. Triggers locked: on update only,
  all patch-touched modules pre-publish, plus a `validateAll({custom, loadAllJsonEntries})` switch. New
  `needs-keys` protocol so a custom validator on a `.jsonValues()` record asks for the keys it needs and
  the caller loads them via the Phase 6 batch loader (validation = its fourth consumer). Stages 3–4:
  instances become primary (`deserialize` leaves the main thread), then delete the now-dead server render
  path. The "renders pincer" decision item is gone — it was premised on a wrong claim that only the server
  could run `select`.
- **Session 5 (2026-07-28)**: enabled/draft runtime path (server + RSC) and edit tags.
  - Merged `main` (which fixed an unrelated blocker: the publish gate read the RAW
    `errors.validationErrors` instead of the surfaced snapshot, so every `s.images()`/`s.files()`
    gallery's always-on `check-unique-folder`/`check-all-files` errors blocked publish while the
    Studio showed none — `0fcfecf0`).
  - `getSources` jsonValues-aware — entry-content ops no longer poison the module's patch chain.
  - `applyJsonValuesEntryPatches` + `rebaseContentOp` moved into `patch/jsonValuesPatch.ts`; new
    `ValOps.getJsonEntry`; `/json` gained `apply_patches` (default true; Studio opts out).
  - `stegaEncode` `root` seed + `getJsonEntryStegaRoot` → jsonValues entries finally get edit tags;
    `SET_AUTO_TAG_JSX_ENABLED` now also set by the single-entry readers.
  - RSC `fetchValKey`/`fetchValRoute` read drafts via `/json`.
  - Test-harness fix: `ValOpsFS.jsonValues.test.ts` evaluated the module in a `vm` whose `require`
    resolved `import("./x.val.json")` relative to the TEST FILE, so entry thunks never loaded.
  - Tests: +2 `getSources` routing, +6 `ValOps.getJsonEntry`, +11 `rebaseContentOp` /
    `applyJsonValuesEntryPatches`, +3 `stegaEncode` root seed (incl. a guard that no seed ⇒ identity).
- **Session 4 (2026-07-27)**: Studio hardening — closes the Phase 3 defects.
  - **Rename/duplicate now commit.** `ValOps.prepare` classifies `op.from` as well as `op.path` and
    gained `move`/`copy` arms: load the source entry's content, remove the old thunk (move only),
    insert the new one at `getNewJsonEntryPaths`, and null the old file. Cross-record and
    cross-entry `move`/`copy` are rejected instead of silently corrupting (`rebaseContentOp` sliced
    `from` by the destination's prefix without checking they matched).
  - **Pre-existing bug fixed**: `analyzePatches` pushed one `patchesByModule` entry per non-file op,
    so `prepare` re-applied the _whole_ patch once per op. Idempotent for `replace`, but it
    duplicated `add`s and broke `move`. Now at most one entry per (module, patch).
  - **Nested `.jsonValues()` rejected** — `findNestedJsonValuesRecords` + a `ModulesError` from
    `initSources` (locked decision #7).
  - **Studio cache lifecycle**: `jsonEntryErrors` (failure memo + field error state),
    `staleJsonEntries` (invalidate on publish and on `/sources/~` refresh), `retryJsonEntry`,
    `ensureJsonEntry`. Publish needs its own invalidation because a content-only edit leaves the
    module source (bare markers) byte-identical, so `sourcesSha` never changes and nothing refetches.
  - **Rename guard**: `ChangeRecordPopover` awaits `ensureJsonEntry` before emitting the `move`, so
    the patch carries real content instead of an opaque marker (which would 404 on the new key).
  - Tests: `ValOpsFS.jsonValues.test.ts` (+7), `jsonValuesPatch.test.ts` (+6),
    `validateJsonValues.test.ts` (+1 pinning the root-only contract), and a new `jsonValues`
    describe in `ValSyncEngine.test.ts` (+8, was zero coverage) with `/json` + `/save` added to the
    mock client.
- **Session 3 (2026-07-03)**: `fetchValRoute`/`useValRoute` made jsonValues-aware — they now map
  route params → the entry key and load ONLY the matched entry (RSC `loadJsonEntryContent`; client
  reuses the `useValKey` `React.use` cache), instead of eagerly resolving the whole record. Added
  `isJsonValuesRecordSchema` to `routeFromVal.ts`; return types gained the `JsonSource<C> ? C` branch.
  Example support page switched to `fetchValRoute`; `examples/next` `next build` green. `-r typecheck`
  - next tests green.
- **Session 2 (2026-07-03)**: Commit flow landed. New `patch/jsonValuesPatch.ts` (op classifier +
  path helpers), new `insertValJsonEntry`/`removeValJsonEntry` in `patch/ts/ops.ts`, and a rewritten
  `ValOps.prepare.applySourceFilePatches` that routes ops into `*.val.json` writes/deletes +
  `.val.ts` thunk insert/remove, skipping the `.val.ts` on pure content edits. Tests:
  `jsonValuesPatch.test.ts`, `jsonValuesEntry.test.ts`, `ValOpsFS.jsonValues.test.ts`. Whole
  `pnpm test` (1056) + `-r typecheck` green.
- **Session 1**: Phase 1 (core) complete + tested; Phase 2 loader done + tested;
  `createValJsonReference` primitive done + tested. Whole monorepo typechecks (except pre-existing
  unrelated `packages/cli` chokidar error). `JsonSource` redesigned to a phantom-typed pure-JSON
  marker (`_import` is runtime-only via `getJsonImport`) so `Source` stays JSON-serializable.
- _(baseline)_ tracker created; design approved.
