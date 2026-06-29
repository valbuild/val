# Implementation tracker: `.jsonValues()` — lazily-loaded JSON entries

> Living implementation plan for `s.record(...).jsonValues()` / `s.router(...).jsonValues()`.
> The **design rationale + locked decisions** live in the approved design doc
> (`~/.claude/plans/i-want-a-new-humming-zebra.md`). This file tracks **what's done /
> what's next** so we can resume across sessions. Keep the "Current state" block at the
> top up to date after every work chunk.

---

## Current state / resume here

> **Expected-behavior note (verified in the example, 2026-06-29):** opening a jsonValues entry in
> the **Studio** (`/val/~/.../page.val.ts?p="/support/getting-started"`) throws
> `Cannot resolve path into a jsonValues entry until its content is loaded` — this is the intentional
> `resolvePath` guard (module.ts) firing because the Studio lazy-load of entry content isn't built
> yet (UI task + single-entry endpoint, both pending). The **production read** path
> (`/support/getting-started` rendered via `fetchValKey`) is wired. So: reading works; Studio editing
> of jsonValues entries is the next milestone (endpoint → UI).

- **Phase**: 1 ✅. Phase 2 server mostly done (validation + sha + loader + emit primitive); Phase 4
  started — RSC `fetchValKey` implemented (production path). **Next: example app to validate the
  runtime read path end-to-end, then the commit flow + single-entry endpoint.**
- **Single-entry runtime read API (typecheck-validated, runtime-validation via example pending)**:
  - RSC `fetchValKey` — `initFetchValKeyStega` in `next/src/rsc/initValRsc.ts` (returned as
    `fetchValKeyStega`). Resolves ONE entry by key from the local module's thunk + stega-encodes.
  - Client `useValKey` — `useValKeyStega` in `next/src/client/initValClient.ts` (returned as
    `useValKeyStega`). Uses a module-level promise cache + `React.use` (Suspense) to load one entry.
  - Both: production path resolves the local thunk; Enabled/Studio **draft** path is a TODO (needs
    the single-entry endpoint + a sub-selector for stega edit tags). Still TODO: make `fetchValRoute`/
    `useValRoute` use the key path for jsonValues routers (load one).
- **Next step (the deep part)**: wire the json commit flow in `ValOps.ts`/`ValOpsFS`/`ValOpsHttp`:
  (a) shallow-serialize json records to `{ key: { _type:"json", _sha } }` markers for `/sources/~`
  (the runtime thunk must be dropped — `getJsonImport` reads it at runtime only); (b) on commit,
  write/replace/delete `*.val.json` files + emit/update the `c.json(...)` thunk in the `.val.ts`
  using `createValJsonReference` (already in `patch/ts/ops.ts`) via `insertAt`/`removeAt`/
  `replaceNodeValue`; (c) per-entry content load (invoke `getJsonImport(marker)?.()` or read the
  file by AST-derived path) + sha-keyed incremental validation calling
  `RecordSchema.validateJsonEntryContent`. Then the single-entry fetch endpoint in `ValServer.ts`.
- **Last verified green**: core json suite (14 tests) + server `validateJsonValues`/loader/
  `jsonReference` suites; core + server typecheck. (Earlier: whole-monorepo `-r typecheck` clean
  except the pre-existing unrelated `packages/cli` chokidar failure.)
- **Key API note**: `JsonSource` is a phantom-typed pure-JSON marker; the lazy thunk is
  runtime-only — read it with `Internal.getJsonImport(source)`, never `source._import` in typed code.
- **Done since**: server-side per-entry json validation (`validateJsonValues.ts`, wired into
  `ValOps.validateSources`); core `Internal.resolveJsonValues(source)` (eager resolver for the
  `fetchVal`/`useVal` path); **sha helper `jsonValuesSha.ts`** (`computeJsonEntrySha` =
  `<schemaHash>-<contentHash>`, `isJsonEntryShaCurrent`, `getSchemaHashFromJsonSha`) implementing the
  revalidation-signal design — the commit flow should write this sha; the sha-keyed validation
  skip-cache should use `isJsonEntryShaCurrent`. **Discovered gap**: even eager `fetchVal` must
  resolve markers before stega-encoding (a jsonValues module's local source is markers, not content)
  — use `resolveJsonValues` there.
- **Runtime integration notes (for fetchValKey/fetchVal in next/react)**: disabled/production path
  reads the local module (`Internal.getSource`) whose markers still carry thunks → resolve locally
  (`getJsonImport` for one key, `resolveJsonValues` for all). Enabled/Studio path gets shallow
  markers from `/sources/~` WITHOUT thunks → needs the single-entry fetch endpoint (Phase 2) to load
  draft content; until then it can fall back to the local thunk (committed content only).

---

## Goal (one paragraph)

Let `s.record(...)` and `s.router(...)` (NOT `s.images()` / `s.files()` galleries) opt into
`.jsonValues()`, so each entry's value lives in its own `*.val.json` file referenced by a lazy
thunk `c.json(() => import("./x.val.json"), "<contentSha>")`. Keeps `.val.ts` tiny at 10K+
entries; runtime/Studio/validation work one entry at a time; zero overhead when Val is disabled.

## Locked decisions (do not relitigate)

1. `fetchVal`/`useVal` stay eager; new `fetchValKey`/`useValKey` + `fetchValRoute`/`useValRoute`
   load a single entry.
2. Hybrid authoring: Val generates/maintains json files + thunks; hand-edits re-validated.
3. The sha = validation-cache key (auto-generated), formatted as **`"<schemaHash>-<contentHash>"`**
   with the **schema hash as a PREFIX** (NOT hashed together). The prefix is the key property: you
   can compare the current item-schema hash against each entry's sha prefix to know the entry needs
   revalidation **without reading the entry's content** — the `.val.ts` already lists every entry's
   sha. Revalidate when EITHER the prefix differs from the current schema hash (schema changed →
   whole record) OR the content hash differs (that entry changed). Implemented in
   `jsonValuesSha.ts` (`computeJsonEntrySha`, `getSchemaHashFromJsonSha`, `isJsonEntryShaCurrent`).
   See "sha design" below.
4. Type precision: keep object/array structure, widen only what JSON can't carry
   (literals → base, drop `RawString`/brand, widen `_type` literals). Runtime validation enforces
   strictness. Val object-unions are always discriminated, so distribute+recurse suffices.
5. i18n deferred; design json format locale-agnostic.
6. All-or-nothing: every entry of a `.jsonValues()` record is a `c.json` thunk (no mixing).

## Key runtime shapes

`JsonSource<T>` is a phantom-typed **pure-JSON marker** so `Source` stays JSON-serializable:

```ts
// JsonSource<T> TYPE (what flows through Source/SelectorSource):
{ _type: "json", _sha: string, patch_id?: string } & PhantomType<T>

// RUNTIME value produced by c.json(thunk, sha) — also carries the thunk, which is
// NOT in the type; read it via Internal.getJsonImport(source):
{ _type: "json", _import: () => Promise<{ default: T }>, _sha: string }

// Over the wire (/sources/~): the marker only (thunk dropped):
{ _type: "json", _sha: string, patch_id?: string }
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
- [x] `patch/ts/ops.ts`: `createValJsonReference(importPath, sha)` — emits
      `c.json(() => import("..."), "sha")` (factory-built; uses `createIdentifier("import")` to print
      a dynamic import without casting the ImportKeyword token). Tested in `jsonReference.test.ts`. ✅
- [ ] `patch/ts/ops.ts` (remaining): wire add/replace/remove of json entries through
      `insertAt`/`removeAt`/`replaceNodeValue` (+ write/replace-sha/delete `*.val.json`) — done with
      the ValOps commit flow below.
- [x] **Per-entry validation**: `validateJsonValues.ts` (`validateJsonValuesEntries`) loads each
      entry's content via `getJsonImport` and validates against the item schema; wired into
      `ValOps.validateSources` (runs before the `res === false` early-continue). Tested in
      `validateJsonValues.test.ts` (valid/invalid/load-error/non-jsonValues-skip). ✅
- [ ] `ValOps.ts` / `ValOpsFS.ts` / `ValOpsHttp.ts` (remaining): confirm shallow source
      serialization on `/sources/~` (JSON.stringify already drops the thunk → `{_type,_sha}`);
      commit writes `*.val.json` + updates `.val.ts` shas/thunks (use `createValJsonReference` +
      `insertAt`/`removeAt`/`replaceNodeValue`); sha-keyed incremental validation (optimization);
      recompute SHAs.
- [x] Core eager resolver `Internal.resolveJsonValues(source)` (for `fetchVal`/`useVal`). ✅
- [ ] `ValServer.ts`: endpoint to fetch one entry's content (draft-aware via `patch_id`);
      `/sources/~` returns shallow markers for json records.
- [ ] **Verify**: `pnpm test packages/server/...` green (ops add/replace/remove, loader fixture,
      incremental validation).

## Phase 3 — UI (`packages/ui/spa`)

- [ ] `ValSyncEngine.ts`: model json records as `{ key → { sha, patch_id? } }`; lazy fetch + cache
      one entry on open; per-entry patches; sha-aware invalidation.
- [ ] `components/ValFieldProvider.tsx`: reuse `useShallowSourceAtPath` for the key list; add a
      hook to lazily fetch one entry's content (`useJsonEntrySource` / extend `useSourceAtPath`).
- [ ] `components/fields/RecordFields.tsx` + router nav: render keys without loading content; load
      on open; build per-entry add/replace/remove patches.
- [ ] **Verify**: manual Studio pass (list shows keys w/o loading; open fetches one json;
      edit→commit writes file + updates sha; add/remove a route inserts/removes thunk + file).

## Phase 4 — Runtime APIs (`packages/next`, `packages/react`)

- [ ] `rsc/initValRsc.ts`: `fetchValKey` / `fetchValRoute` (route matching reuses `ValRouter`).
- [ ] `client/initValClient.ts`: `useValKey` / `useValRoute`.
- [ ] Apply existing stega/transform per resolved entry.
- [ ] **Verify**: `fetchVal` still returns all; `fetchValRoute` imports only the requested entry.

## Phase 5 — Example + CI gate

- [ ] Add a `.jsonValues()` router to `examples/next` with a few `*.val.json` entries.
- [ ] `cd examples/next && pnpm run build` green; confirm single-entry import in output.
- [ ] Full CI: `pnpm run lint`, `pnpm -w run format`, `pnpm run -r typecheck`, `pnpm test`,
      `pnpm run build`, `cd examples/next && pnpm run build`.

---

## sha design (revalidation signal)

The trailing sha in `c.json(thunk, sha)` is the validation-cache key, formatted
**`"<schemaHash>-<contentHash>"`** (schema hash as PREFIX), and must answer "must we revalidate this
entry?" cheaply — ideally **without reading the entry's content**:

- **Schema hash = prefix.** Derived from the serialized item schema (stable serialization) and
  written as the part before the `-`. Keep them as separate joined components, NOT hashed together,
  so the prefix stays readable. Truncated small (currently 8 hex chars) — it only needs to detect
  schema _changes_, not be collision-proof.
- **Cheap staleness scan (the point):** after a schema change, compute the current item-schema hash
  once, then walk the record's entry shas (already present in the `.val.ts`) and flag every entry
  whose sha PREFIX differs — no `*.val.json` is loaded. Those entries need revalidation.
- **Content hash** (suffix) flips when the backing `*.val.json` content changes ⇒ revalidate just
  that entry; the commit flow rewrites the sha. (Computing the content hash _does_ require the
  content, but you only reach it for entries whose schema prefix already matches.)
- **Validation skip-cache:** `validateJsonValuesEntries` (today validates every entry) becomes:
  if the entry's stored sha prefix ≠ current schema hash ⇒ must revalidate (load + validate, rewrite
  sha); else look up `sha → lastValidationResult` and skip on a cached PASS, otherwise load +
  validate + cache. Use `isJsonEntryShaCurrent` / `getSchemaHashFromJsonSha` from `jsonValuesSha.ts`.
- **Hybrid hand-edit safety:** a hand-edited json whose content no longer matches the suffix forces
  revalidation; Val rewrites the sha on next commit.

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
- Canonical content hashing so hybrid hand-edits and Val-writes agree on the sha.

## Changelog

- **Session 1**: Phase 1 (core) complete + tested; Phase 2 loader done + tested;
  `createValJsonReference` primitive done + tested. Whole monorepo typechecks (except pre-existing
  unrelated `packages/cli` chokidar error). `JsonSource` redesigned to a phantom-typed pure-JSON
  marker (`_import` is runtime-only via `getJsonImport`) so `Source` stays JSON-serializable.
- _(baseline)_ tracker created; design approved.
