# Implementation tracker: `.jsonValues()` — lazily-loaded JSON entries

> Living implementation plan for `s.record(...).jsonValues()` / `s.router(...).jsonValues()`.
> The **design rationale + locked decisions** live in the approved design doc
> (`~/.claude/plans/i-want-a-new-humming-zebra.md`). This file tracks **what's done /
> what's next** so we can resume across sessions. Keep the "Current state" block at the
> top up to date after every work chunk.

---

## Current state / resume here

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
- [ ] `ValServer.ts`: endpoint to fetch one entry's content (draft-aware via `patch_id`);
      `/sources/~` returns shallow markers for json records.
- [ ] **Verify**: `pnpm test packages/server/...` green (ops add/replace/remove, loader fixture,
      incremental validation).

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
- [ ] Enabled/Studio draft path: resolve draft content via `/json` (+ sub-selector stega tags).
      (fetchValKey/useValKey + fetchValRoute/useValRoute all still read the LOCAL committed thunk on
      the enabled/draft path — draft edits aren't reflected until commit.)

## Phase 5 — Example + CI gate

- [x] Add a `.jsonValues()` router to `examples/next` with a few `*.val.json` entries
      (`app/support/[slug]/page.val.ts` + `content/*.val.json`); consumed via `fetchValRoute`.
- [x] `cd examples/next && pnpm run build` green (`/support/[slug]` dynamic route builds).
- [ ] Full CI in one pass: `pnpm run lint`, `pnpm -w run format`, `pnpm run -r typecheck`,
      `pnpm test`, `pnpm run build` (root preconstruct+ui; remember `pnpm preconstruct dev` after),
      `cd examples/next && pnpm run build`.

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

## Changelog

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
