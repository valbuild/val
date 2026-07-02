# Implementation tracker: `.jsonValues()` — lazily-loaded JSON entries

> Living implementation plan for `s.record(...).jsonValues()` / `s.router(...).jsonValues()`.
> The **design rationale + locked decisions** live in the approved design doc
> (`~/.claude/plans/i-want-a-new-humming-zebra.md`). This file tracks **what's done /
> what's next** so we can resume across sessions. Keep the "Current state" block at the
> top up to date after every work chunk.

---

## Current state / resume here

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
  `fetchValKey`/`useValKey` ✅ (production path). Example (support pages) added + typechecks.
  **The `c.json` sha was removed (2026-07-02).** Remaining: end-to-end Studio verify of add/remove/
  edit against a running dev server; `fetchValRoute`/`useValRoute` key path; Enabled/Studio draft
  runtime path; Phase 5 CI gate (example `.jsonValues()` router + `examples/next` build).
- **Single-entry runtime read API (typecheck-validated, runtime-validation via example pending)**:
  - RSC `fetchValKey` — `initFetchValKeyStega` in `next/src/rsc/initValRsc.ts` (returned as
    `fetchValKeyStega`). Resolves ONE entry by key from the local module's thunk + stega-encodes.
  - Client `useValKey` — `useValKeyStega` in `next/src/client/initValClient.ts` (returned as
    `useValKeyStega`). Uses a module-level promise cache + `React.use` (Suspense) to load one entry.
  - Both: production path resolves the local thunk; Enabled/Studio **draft** path is a TODO (needs
    the single-entry endpoint + a sub-selector for stega edit tags). Still TODO: make `fetchValRoute`/
    `useValRoute` use the key path for jsonValues routers (load one).
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
- [ ] **Per-entry patches**: editing an entry field produces a normal patch at the entry path; on
      commit the server commit-flow writes the `*.val.json` (Phase 2 commit flow). Add/remove entry =
      add/remove the record key (commit flow emits/removes thunk + file).
- [ ] **Verify** (Studio running): list shows keys w/o loading; opening an entry fetches one `/json`;
      fields render + edit; commit writes the `*.val.json`; add/remove a route inserts/removes
      thunk + file.

## Phase 4 — Runtime APIs (`packages/next`, `packages/react`)

- [x] `rsc/initValRsc.ts`: `fetchValKey` (`initFetchValKeyStega`, returned as `fetchValKeyStega`).
- [x] `client/initValClient.ts`: `useValKey` (`useValKeyStega`, promise cache + `React.use`).
- [x] Example wires `fetchValKey` (support pages) — typechecks clean.
- [ ] `fetchValRoute` / `useValRoute`: use the key path for jsonValues routers (load one entry by
      matching the route), instead of the eager fetchVal. (Reuse `ValRouter` to map route→key.)
- [ ] Enabled/Studio draft path: resolve draft content via `/json` (+ sub-selector stega tags).

## Phase 5 — Example + CI gate

- [ ] Add a `.jsonValues()` router to `examples/next` with a few `*.val.json` entries.
- [ ] `cd examples/next && pnpm run build` green; confirm single-entry import in output.
- [ ] Full CI: `pnpm run lint`, `pnpm -w run format`, `pnpm run -r typecheck`, `pnpm test`,
      `pnpm run build`, `cd examples/next && pnpm run build`.

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
