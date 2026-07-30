# Implementation tracker: `.jsonValues()` — lazily-loaded JSON entries

> Living implementation plan for `s.record(...).jsonValues()` / `s.router(...).jsonValues()`.
> The **design rationale + locked decisions** live in the approved design doc
> (`~/.claude/plans/i-want-a-new-humming-zebra.md`). This file tracks **what's done /
> what's next** so we can resume across sessions. Keep the "Current state" block at the
> top up to date after every work chunk.

---

## Current state / resume here

> **Reference-integrity defect found (2026-07-30) — Phase 6 is the next milestone, NOT started.**
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
- [ ] Full CI in one pass: `pnpm run lint`, `pnpm -w run format`, `pnpm run -r typecheck`,
      `pnpm test`, `pnpm run build` (root preconstruct+ui; remember `pnpm preconstruct dev` after),
      `cd examples/next && pnpm run build`.

## Phase 6 — Reference integrity + search over un-loaded entries — NEXT MILESTONE

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

1. **Batch transport** — `ValOps.getJsonEntries` (hoist `initSources`/`fetchPatches`) + `/json` batch
   mode + `ApiRoutes` zod, with server tests. Everything below depends on this.
2. **Engine primitives** — `requestJsonEntries(mfp, keys)` (window, fire-and-forget) +
   `ensureJsonEntries(modules)` (whole-module, awaitable) + progress store, and fold
   `markAllJsonEntriesStale` into the batch path. Extend the `jsonValues` describe in
   `ValSyncEngine.test.ts`.
3. **List view** — virtualize `RecordFields` (both branches) with `@tanstack/react-virtual`, load the
   rendered window via `requestJsonEntries`, **skeletons for un-loaded rows on all three preview paths**
   (a marker must never reach a preview component). → **V16**. First visible win; also the first real
   load-test of steps 1–2.
4. **Predicate** — `jsonValuesLoadRequirements` + its unit tests (pure; could be done any time, but it
   only pays off once the hooks below use it).
5. **Ref hooks + popover gating** — hooks return a status, destructive popovers gate on `success`.
   → **V10–V13, V17**. This is where the data-integrity hole actually closes.
6. **Search** — first-query trigger, debounced re-index, marker skip in `traverseSchemaSource`, delete
   the dead `createSearchIndex.ts`. → **V14**.
7. **`.render()` list layouts (windowed)** — per-key `render` on the batch `/json` response + partial
   `items` merged into the client renders map. → **V18**. **Gated on the renders-are-null decision** in
   its work item; until that is answered, step 3's skeleton + `<Preview>` fallback IS the list preview.
   Deliberately last: it is the only step that depends on a Studio-wide question rather than on
   jsonValues.
8. **Verify + gate** — the full manual walkthrough (V1–V18, noting V1 is superseded; V1–V9 have still
   never been run) then the Phase 5 CI gate.

The caching decision (last item below) is deliberately NOT in this order — it is a question for Fredrik,
not a step.

### Work items

- [ ] **Batch `/json` (transport)** — `ApiRoutes.ts`: GET `/json` grows a batch mode. `keys` (JSON
      array param, client-driven paging, cap the batch server-side) **and** `offset`/`limit` for
      all-mode. Response returns an array of `{key, content}` (plus the resolved `offset`/`limit`/
      `total` for all-mode). Keep the existing single `key` form working — the entry-open path must not
      get slower. `apply_patches` semantics unchanged (Studio passes `false`).
- [ ] **Batch `ValOps.getJsonEntries(mfp, {keys | offset+limit}, {applyPatches})`** —
      `getJsonEntry` currently calls `initSources()` AND `fetchPatches()` per entry
      ([ValOps.ts:272](../../packages/server/src/ValOps.ts#L272)); a batch MUST hoist both out of the
      loop or "load 500 entries" becomes 500 patch fetches. Keep `getJsonEntry` as a thin wrapper over
      the batch so there is one code path.
- [ ] **`jsonValuesLoadRequirements(schemas, query)`** — new pure module in `packages/ui/spa`
      implementing the predicate above. `query` is one of `{kind:"keyOf", module}` /
      `{kind:"file", module}` / `{kind:"route"}`; returns the `ModuleFilePath[]` whose entries must be
      loaded. Own unit test file: empty result for the incoming-ref case, non-empty for nested
      `keyOf`/image/file, `route` over-approximation, transitivity through object/array/record/union.
- [ ] **`ValSyncEngine.ensureJsonEntries(moduleFilePaths)`** — idempotent batch loader: for each
      module, diff the marker key set against `jsonEntryContents` + `staleJsonEntries`, request the
      missing keys in chunks (start at 50) through the batch endpoint, fill the SAME
      `jsonEntryContents` cache, then the existing invalidate + emit. Returns a promise that resolves
      when the requested modules are fully loaded. Never fires on Studio boot.
- [ ] **Progress store** — `{loaded, total, status}` (not a boolean) exposed as a sync-external-store
      snapshot (`subscribe("json-entries-progress")` + `getJsonEntriesProgressSnapshot()`), so any
      component can render "Checking references… 340/5000". `total` needs no server help: the client
      already has every entry key from the marker record.
- [ ] **`ValSyncEngine.requestJsonEntries(mfp, keys)`** — the window-based sibling of
      `ensureJsonEntries`: fire-and-forget, takes an explicit key list, skips cached/in-flight/errored
      keys, batches the rest in one request. This is what the virtualized list calls per rendered
      window; `ensureJsonEntries(modules)` (awaitable, whole-module) stays for the refs guard and search.
      Both share the chunking + cache + emit path.
- [ ] **Virtualize the record list + load visible rows only** — `RecordFields.tsx`: wrap both list
      branches (default grid at :162 and `ListRecordRenderComponent` at :191) in
      `useVirtualizer` from `@tanstack/react-virtual`, and for a jsonValues record call
      `requestJsonEntries(mfp, visibleKeys)` from the rendered window (debounced; drop stale windows).
      Un-loaded rows render a skeleton, not an error. Non-jsonValues records get virtualization too
      (same code path, no loading) — a 10k-key ordinary record renders 10k previews today.
- [ ] **Skeletons for un-loaded jsonValues rows (all three preview paths)** — a marker must never reach
      a preview component. `PreviewWithRender` → `useRefPreview` miss → `<Preview>` →
      `ObjectPreview`/etc. reading a marker is exactly today's broken state. So: when the parent schema is
      a jsonValues record and the entry's content is not in `jsonEntryContents`, render a skeleton
      (a) instead of the `<Preview>` fallback, (b) instead of a `ListPreviewItem` when the key is missing
      from a partial `items` array, and (c) for the `errored` case a small retry affordance rather than a
      dead row. Skeleton must be the same height as a loaded row or the virtualizer's measurements jump.
- [ ] **`.render()` list layouts for jsonValues records (windowed)** — drop the `isJsonValues` early
      return in `RecordSchema.executeRender` and instead compute renders for the keys whose content the
      caller has. Shape: - The user's `select({key, val})` lives in the schema INSTANCE, so only the SERVER can run it (the
      client has serialized schemas only). Batch `/json` therefore returns `render` per key next to
      `content` — one more field on the same response, no extra round trip. - The record-level `ListRecordRender.items` is `[key, {title, subtitle?, image?}][]`
      ([render.ts:9](../../packages/core/src/render.ts#L9)) — an ALL-ROWS payload, so it can never be
      produced eagerly for a 10k jsonValues record. It becomes **partial**: the client merges the render
      values it has received into the module's renders map, and `items` holds only loaded keys. - This works with zero changes to the consumer: `resolveRefPreview` looks the row up by key
      (`items.find(([itemKey]) => itemKey === key)`,
      [useRefPreview.ts:82](../../packages/ui/spa/components/useRefPreview.ts#L82)) and returns
      `undefined` on a miss — which the previous work item turns into a skeleton. - **BLOCKER (Studio-wide, not jsonValues-specific): renders are null in the Studio today.**
      `/sources/~` only computes them when `apply_patches` is true
      ([ValServer.ts:1479](../../packages/server/src/ValServer.ts#L1479)) and the Studio always sends
      `false`, so `ValSyncEngine` stores `valModule.render || null` and every list already falls back to
      `<Preview>`. `setRenders` is called from stories only. So `.render()` list layouts are dead for
      ALL schema types right now, and fixing jsonValues alone changes nothing visible. - **DECISION NEEDED (ask Fredrik)**: renders need the user's `select` (server-only) AND the PATCHED
      source (client-only, because the Studio owns in-flight patches) — that pincer is why they are off.
      Options: (i) a dedicated render request with `apply_patches:true`, accepting that a render lags an
      unsaved edit (a row would show the committed title while the user is editing it); (ii) make the
      title/subtitle/image selection serializable so the client can evaluate it; (iii) leave renders off
      and treat `<Preview>` as the only list preview. Same class of limitation as the `useValKey` draft
      path already tracked in Phase 4. Pick one before building this item.
- [ ] **Ref hooks stop lying** — `useEagerRouteReferences` / `useKeysOf` / `useReferencedFiles` return
      a status (`loading` + progress → `success` with COMPLETE refs → `error`) instead of a bare array.
      Each hook calls `jsonValuesLoadRequirements` first; empty ⇒ synchronously `success` (today's
      behaviour, no request). Non-empty ⇒ `ensureJsonEntries` and report progress.
- [ ] **Popovers gate on completeness** — `DeleteRecordPopover` / `ChangeRecordPopover` render progress
      and refuse to act until `success`; on `error` they stay blocked with a retry. Never
      "no refs found, go ahead". This is the actual fix for the defect.
- [ ] **Search** — trigger `ensureJsonEntries(all jsonValues modules)` **only on user intent**: search
      is lazy, so nothing loads before it is requested. Trigger on the first non-empty query, NOT on
      `SearchField` mount / dialog open (radix mounts the content when the dialog opens, so a
      mount-effect trigger would load on open). **Debounce the re-index** —
      [Search.tsx:121-138](../../packages/ui/spa/components/Search.tsx#L121-L138) rebuilds the whole index
      on every `sources` change and would otherwise rebuild once per batch.
- [ ] **Search shows partial results + a percentage while loading** — results appear IMMEDIATELY from
      whatever is already indexed (never a blocked/empty dropdown waiting for a full load), and the
      dropdown carries a loading indicator with a **percentage** — `Math.round(loaded / total * 100)` off
      the progress store, e.g. "Searching… 42% indexed". The list re-renders as each batch lands and the
      indicator disappears at 100%. Two details that matter: the percentage must be over the whole
      requested set (all jsonValues modules), not per module, or it resets visibly on every module
      boundary; and results arriving late must not reorder/jump what the user is already looking at more
      than the new matches require.
- [ ] **Fix the live search traversal** — add the marker skip to `traverseSchemaSource` (interim
      correctness + kills the `_type`/`patch_id` edge).
- [ ] **Delete the dead `createSearchIndex.ts` + `search.test.ts`** and the unused barrel export in
      `search/index.ts`. The marker skip added there was on unreachable code.
- [ ] **Fold `markAllJsonEntriesStale` into the batch path** —
      [ValSyncEngine.ts:1063](../../packages/ui/spa/ValSyncEngine.ts#L1063) currently re-requests every
      loaded entry one-by-one, so with hundreds cached a publish is a request storm today. The progress
      store must cover this post-publish refresh too: anything transitively derived from stale entries
      (entry detail view, refs guard, search index) goes back to `loading` with progress rather than
      briefly rendering stale or content-free values. In particular a refs query must NOT answer from
      stale content — it re-enters `loading`.
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
  - **V18** (step 7 only) a jsonValues record WITH `.render({layout:"list"})` → visible rows show the
    user's title/subtitle/image; rows below the fold are skeletons of the same height (no measurement
    jump, no marker reaching a preview component); scrolling fills them in. Then edit a visible row's
    title without publishing → confirm what the row shows, and that it matches whichever option was
    chosen in the renders decision (it will show COMMITTED content under option (i)).
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
- **Where do per-entry renders come from for jsonValues?** `executeRender` returns `{}` for these
  records and Studio renders are null across the board today — see the Phase 6 list-view subsection.

## Changelog

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
