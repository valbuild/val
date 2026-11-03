# One content model: every reader, one version, one way to load

> **Status: proposed 2026-11-01; phase 0 nearly done; phases 1 to 5 built
> (2026-11-02); of phase 7, the parts phase 6 does not block (2026-11-03),
> while phase 6 waits for a deployed 128 MB check.** See
> [Where we are](#where-we-are) for what is built, what runs, and what comes
> next. A session that changes the design updates this file in the same PR as
> the change.

Content is read in about fifty places (listed in
[The inventory](#appendix-the-inventory)): the app's readers in and out of
draft mode, the Studio's stores, the canvas, Val's server, MCP, the CLI and
the hosting platform. Each was added for a reason, and each pairs a schema
with content in its own way. The bugs we keep meeting are where two of them
disagree: a preview that flickers, an edit that does not show, a page that
shows two versions of the content at once.

This plan reduces that to **one version** (which includes the code the
content belongs to), **one store** that holds modules by that version, **one
way to load** that `fetchVal`, `useVal` and the Studio all go through, and
**one engine** that turns patches into content. What differs between readers
is only where the data comes from and how they wait for it.

And it makes the result testable: a scenario sets up the world it runs in
(server mode, Studio, page, draft mode, network, clock, code) and is checked
against the same invariants as every other scenario, so adding an edge case is
a few lines and a broken invariant is caught by name.

## Where we are

As of 2026-11-01, on the PR "Simplify content retrieval and improve test
coverage" (valbuild/val#1006).

**Built:**

- **The scenario world** (`scenarios/`, phase 0): Val's real server in memory,
  fs and http mode (http against `e2e/mock-content-host`, imported into the
  test's process, with the content service's socket), Studios with the real
  `/stat` loop on one fake clock, a
  page's server and client halves, the overlay relay, the refresh loop,
  uploads, two builds answering at once, and code changes. Every scenario is
  checked against shared invariants and counted work. About ten pieces of
  product code moved out of components into plain functions the product now
  calls (`.agent/rules.md`, test rule 3).
- **The scenario catalogue**: see `scenarios/README.md`. Skipped scenarios are
  findings: each has a running test beside it pinning today's behaviour.
- **The content-shape matrix** (`scenarios/src/matrix.*`): every shape
  against every operation and reader, in memory, fs and http. After a publish in fs
  mode the world re-evaluates the rewritten files with `loadValModules`, as a
  dev server reloads them, and serves `public/` as the framework does; the
  publish cells that failed before that (F3, P1) were the world, not the
  product. R1 (memory mode's readers not adopting a publish) is fixed: every
  Val server in a process shares one data layer per project
  (`sharedValOps`). R2 is fixed too: a publish marks the entries it wrote
  (`patch_id` on the marker), and the readers load a marked entry from the
  server rather than from a bundle that has not been rebuilt. Every matrix
  cell passes, in all three modes.
- **The hosted layers** (S06, S20, S21, decision 1 below): a content version
  and a proposal snapshot handed to the API and the readers alike, and a
  `/stat` answer delivered after a later write. All pass.
- **Proposals, written** (P1-P5, `proposals.scenario.test.ts`): the mock
  content host keeps a chain per branch, opens proposals, saves and stages
  into them, keeps the overlay the platform serves an address from, and
  merges (sealed at the press: no publish job, no build -- the README lists
  what it does not do). A world opens one and serves its address; an edit
  there stays off the site, a save makes it the proposal's, two editors
  share it, a staged `.val.ts` (through `write_files`) is its Source, and
  Publish merges it into the site. The new routes are pinned in
  `homeWireContract.test.ts`. All pass.
- **Code mode, wired** (C1-C6, `codeMode.scenario.test.ts`): the `</>` and
  Save's Commit and Publish on content's code-mode contract (valbuild/home
  8689c94). Val's server saves every pending change before turning code mode
  on and before each code write (`beforeProposalCodeWrite` in `ValServer`),
  and refuses a code write while it is off; the Studio's code tools refuse
  too, naming who turned it off, and the assistant asks with
  `request_code_mode`. The view is each person's (`codeMode.ts`). S10b's
  hosted form passes (C5); its local-development form stays failing, because
  HMR is no write through the server (see `addedField.scenario.test.ts`).
- **Build on their push** (C7-C10, `codeMode.scenario.test.ts`): a developer's
  push to `val/p/<name>` refuses Commit and Publish (C6); the refusal offers
  Build on their push (`buildOnTheirPush`, on home's take-push contract),
  which brings their files in, keeps the proposal's version where both
  changed a file, and makes their commit the next Commit's parent. The
  preview is rebuilt, Publish waits for it, and the notice follows their
  push if it moves again. A refused Publish shows the same notice in its
  dialog -- also when a builder tab pressed it -- and a commit message typed
  before a builder tab's Publish now goes with the tab's press.
- **Measurements** (`scenarios/measure/`): how to measure, and the first
  results.
- **Versions on the wire** (phase 1, 2026-11-02). `ModuleVersion` and
  `ProjectVersion` are in `@valbuild/shared/internal`
  (`content/version.ts`), with `extendChain`, `moduleKey` and the functions
  that hash a schema and a base. Val's server keeps every module's `schema`
  and `base` from when the modules are evaluated or a base is adopted (a
  snapshot, a publish), and every chain in a `ChainFold` that is extended
  only by the patches it gained; nothing is hashed on a read, and every hash
  is counted (`versionHashCount`, `version:hash`). `seq`: fs in
  `.val/patches.seq` (beside the lock, not inside `.val/patches/`: delete-all
  and reset rename that directory away), bumped under the lock by every
  write, delete and repair and once per new build; memory per patch store,
  beside `announceChange`; http the content service's `headVersion`.
  `GET /manifest` answers every module's version with its own ETag (304
  while nothing moved; "since `seq` N" is left for phase 7, its first
  reader -- built there, ahead of the reader). `/stat`, `PUT /sources/~`, `GET /patches` and `GET /json` carry
  the version of what they answer. No public API changed and nothing reads
  the versions yet, except the scenario world: every frame records the
  version beside the value (a loader's from the server's answer, through a
  reader-side observer that phase 3 removes; a Studio's from what it holds),
  and the invariants got their stronger forms -- same version same value
  (S22), never read with another schema (S11, every matrix cell), never
  goes back unless the content moved on (S07), the field's version kept
  when its gallery changes (S19), and reads that hash nothing (B04, B05).
  One finding: in http mode `seq` did not move with a new build, because
  `headVersion` did not move with a deployment, so two builds answering
  during a rollout had the same `seq` until somebody wrote. Fixed on
  2026-11-02 in valbuild/home: a deployment going live moves its branch's
  chain version once (`patches.countDeploymentLive`, deduplicated in
  `val_chain_deployments`; a GitHub `success`, a publish job's build put
  live, a CI promote, a proposal's address serving another build), with
  nothing in the chain changed and a `patch_change` so open Studios learn
  it. The mock content host does the same, the scenario world reports each
  new build live to it as the platform would, and S11's "a new build is
  counted" passes on http (it was `test.failing`). The window that is left
  is between a build serving and the service hearing of it.

- **One engine, server side** (phase 2, 2026-11-02). `applyPatchRecord`
  and `applyChain` are in `@valbuild/shared/internal`
  (`content/applyChain.ts`), with the `.jsonValues()` op rules they are built
  on (`content/jsonValuesOps.ts`, moved from the server, which re-exports
  them). Copy-on-write along each op's path: nothing is mutated, an untouched
  subtree keeps its identity, and every copy is counted
  (`engineWork()`: `engine:apply-patch`, `engine:clone-bytes`, 8 bytes a
  reference copied). A module is `{ source, entries }`: an entry the chain
  touched is `content`, `deleted`, an `error` (sticky) or `waiting` (the base
  entry it starts from, with its edits held until somebody loads it); an
  entry the chain never touched costs nothing. `ValOps.getSources` (so
  `getSourcesWithPatchesApplied`, MCP's `loadState` and `prepare`'s
  `moduleVersions` with it) and `getJsonEntries` (`/json`) apply patches
  through it and nothing else, and report where a module's chain stopped
  (`stopped`), so the version `/sources/~` and `/json` answer names the chain
  the content is AT (`ChainFold.chainAt`, no hashing). Deleted: the patch
  rules in `getSources`, the replay in `applyJsonValuesEntryPatches`, and the
  `deepClone` per patch. The old engine survives TEST-ONLY
  (`packages/server/src/patch/legacyEngine.ts`), for the conformance cases
  (`engineConformance.test.ts`: a table, plus random patches on plain JSON
  through both), and goes with them. Budgets: B06 in
  `budgets.scenario.test.ts` (a keystroke copies the root, two references,
  per apply; an edit to one item of 200 copies its path). Still with their
  own engine: the Studio's `SourceStore` (phase 5) and the commit's text
  rewrite (`prepare`'s `.val.ts`/`*.val.json` mirror, by design).
  **What the conformance cases found** -- each a case with the old answer
  pinned beside the new one:
  1. Applying a patch changed the patch: an op's value was inserted by
     reference and then edited by a later op or marked with a file's
     `patch_id`, so every upload wrote a `patch_id` into its own stored patch
     (memory mode, and what `GET /patches` sent). Fixed.
  2. A module whose content became `null`, `""`, `0` or `false` was put back
     to its base before its next patch (`if (!patchedSources[path])`).
     Fixed.
  3. Entries did not stop with their module: after a failing patch, the
     entry read still applied later patches to an entry. Fixed: they stop
     together, and a refused whole-record write leaves entries as they were
     instead of an error per entry.
  4. A file inside an entry was marked in op order, a module field's after
     every op, so a file op before its value failed the entry. Fixed: after
     every op, both.
  5. A `test` of a whole entry wrote a marker with a `patch_id`; content
     moved between two entries was rebased onto the wrong entry; a move from
     a missing entry was refused by the module and an error by the entry.
     The commit refuses the first two, so the read refuses them too now; the
     third is refused, so the destination does not exist.
  6. A replaced (nullable) `.jsonValues()` record kept answering its entries.
     Fixed: they go with it.
  7. A `test` op never failed, because core's `applyPatch` tested a
     Result's truthiness, and the engine kept it a no-op so as not to refuse
     on read what the commit (the same `applyPatch`) accepted. Fixed in core
     and in the engine together: a missing path or a value that is not
     deeply equal fails the patch on both. No producer relied on the no-op:
     nothing in Val writes a `test` op; the MCP `create_patch` tool passes
     one through from its caller.

- **The readers on sources** (phase 3, 2026-11-02). Every reader of both
  frameworks -- `fetchVal`, `fetchValKey`, `fetchValRoute`,
  `fetchValRouteUrl`, `fetchValDraft`, `useVal`, `useValKey`, `useValRoute`,
  `useValRouteUrl` -- is now `resolveVal` (or `resolveValEntry`) over a list
  of `ContentSource`s, and differs from the others only in that list and in
  how it waits. The pieces:
  - `ContentSource`, `ModuleRead` and `EntryRead` are types in
    `@valbuild/shared/internal` (`content/source.ts`), not in
    `@valbuild/react` as drawn above: the server's source is written in
    `@valbuild/server`, which cannot import React's package. (The engine's
    own `EntryRead` was renamed `EntryContent` to free the name.)
  - `@valbuild/react/stega` (`src/read/`): `layered` (the first source that
    does not pass wins; the schema rule), `planOf`, `resolveVal`,
    `resolveValEntry` (and `resolveModuleEntry`, after a view is resolved),
    `awaitResolved` (a server read: wait, resolve again) and `useResolved`
    (a component: `useSyncExternalStore` on `revision`, then `React.use` on
    what is pending) -- the one hook both frameworks' `useValStega` is now,
    as `useResolvedVal` / `useResolvedEntry`. And the sources a page reads:
    `overlaySource` (with the three suspend gates as its states), the
    overlay's store (`ValExternalStore` and `applyValEvent`, moved here from
    both frameworks), `snapshotSource` and `bundleSource`, whose entry
    imports are kept by module OBJECT (a build), which replaces
    `jsonEntryPromiseCache` (kept by path, so it kept a previous build's
    entries).
  - `@valbuild/server` (`draftReads.ts`): `serverDraftSource`, the draft read
    both frameworks had a copy of (the per-request `/sources/~`, the
    `.jsonValues()` entries a draft edits filled through `/json`, one entry
    through `/json`), `draftForRequest` (draft mode, cookies, host) and
    `readerSchemaVersion`. Phase 6 replaces what it reads with the head.
  - The schema rule is in `layered`: a source's answer whose
    `version.schema` is not the reader's own (`readerSchemaVersion`, hashed
    once per module object) is not read. A server reader has nowhere to wait
    for code (its runtime IS the build), so without `codeChanged` the next
    source answers -- which ends at the reader's bundle, content of the code
    that reads it. Only the server's draft carries versions until phase 5.
  - A wait that is over and still answered is passed over (`settled`), so a
    gate whose promise resolved without an answer (draft mode stayed
    unknown, a module the Studio never sent) reads on as it did, instead of
    looping.
  - The seeded draft (`<ValProvider draft>`) stays in the overlay's store,
    as `from: "seeded"`, rather than a source of its own: the refresh loop
    arms on a relayed value that differs from what the page shows
    (`ValExternalStore.receive`), and a seed outside the store would arm it
    on every first relay.
  - The relay sends reads: `source-update` carries `read` (a `ModuleRead`,
    `version: null` until phase 5), which the page keeps as it is. It also
    still carries `source`, for a page of the release before (a rollout);
    that goes in phase 8. The canvas `sourceUpdate` message carries both.
  - **Deleted:** `withJsonValuesEntries`, `draftJsonValuesRecord`,
    `withDraftJsonEntries`, `loadDraftJsonEntry`, `loadDraftSources`,
    `getHost` and `resolveDraftOrCommittedEntry` in each of `initValRsc` and
    `initValContent` (one copy each now, in `@valbuild/server`, or gone into
    `layered`); `draftJsonEntry`, `useDraftModuleSource`,
    `committedJsonEntryPromise`, `jsonEntryPromiseCache` and
    `readCommittedJsonEntry` in both `initValClient`s; TanStack's
    `overlayRead.ts` and `snapshotJsonEntry`; the inline source-priority
    arrays; the suspend gates in both `initValClient`s (now
    `overlaySource`'s states); the error-path `stegaEncode` in both
    `fetchVal`s (a draft that cannot be read is a `pass`, read with the same
    env, so its edit tags are the ones decided once); both copies of
    `ValExternalStore` and its test, Next's inline `val-event` handler and
    TanStack's `applyValEvent`; `jsonValuesRecordToFill`,
    `fillJsonValuesRecord`, `bundledJsonEntryImport`,
    `getJsonEntryStegaRoot` and `isJsonValuesRecordSchema` from both
    `routeFromVal.ts`; and `readObserver.ts`: a server reader says what it
    read itself (`readsOfFetchVal`, `readsOfFetchValDraft`: the read behind
    the public function, which only drops the reads).
  - **What it fixed.** `useValRoute` on a `.jsonValues()` router imported
    EVERY entry (it called `useVal` on the record to keep its hooks in
    order), and `useValRouteUrl` and `fetchValRouteUrl`, which need none,
    imported them all too: now the route's entry, and nothing. Next's
    `useValKey` showed the published entry of a nullable record that a
    draft set to `null`, and gave back `Object.prototype.toString` for an
    entry named `toString` that the draft did not have; it shares
    TanStack's rule now. The error-path bug
    (S25, a visitor given edit tags by the fallback) was fixed on this
    branch before; the path itself is gone, so it cannot come back.
  - **S24 is a scenario** (`readers.scenario.test.ts`), with the page's
    provider steps in the world (`loadPage`'s `draftProp` and `suspend`):
    without `suspend` nothing suspends, with or without the `draft` prop;
    with it and the `draft` prop a route only in a patch is found on every
    render. Two findings, kept `test.failing`: (1) the relay sends
    `sources-synced` before the module with the pending edit -- when the
    Studio's base aligns its chain's records are not in yet, so
    `sendPendingSources` finds nothing -- and a page with `suspend` stops
    waiting and renders the published content first; (2) wait 3, the gate
    is off on the render that decides, so without the `draft` prop a route
    only in a patch is not found at SSR and hydration (known, in
    `quirks.md`).
  - **Budgets:** B07 (`read:resolve`, `read:encode`, from `readWork()`): a
    draft `fetchVal` resolves twice (the draft loading, then in) and
    encodes once; a visitor's resolves and encodes once. B01-B06 unchanged.
  - **Public API:** unchanged. `@valbuild/react/stega` exports the
    pipeline (internal, as the rest of that entry is), `@valbuild/server`
    the draft reads.

- **The page converges** (phase 4, 2026-11-02). A draft page re-reads what
  its server rendered (TanStack's loaders, Next's server components) when the
  Studio says the server HAS the editor's changes, never when an edit
  arrives, and never on a timer. The pieces:
  - **"Confirmed up to this version"** is the server's `ProjectVersion.seq`,
    not a `ModuleVersion`: the Studio computes no versions of its own until
    phase 5 (`withLocalEdits`), and the question the page asks -- is there
    something newer on the server than what I refreshed for? -- is the one
    `seq` answers. The Studio keeps the `seq` of the stat it adopted
    (`StatSnapshot.seq`, from `/stat`'s `version`, or `headVersion` in http
    mode, where the two are one counter and a socket message moves only
    `headVersion`). `subscribeConfirmed` (`sourceRelay.ts`) tells it on an
    adopted stat and, in http mode, on a save's own answer (`patch:saved`'s
    `headVersion`), a stat earlier. A save's answer in fs and memory carries
    no version, so there the stat after it confirms (the long poll answers at
    once). The relay sends `{ type: "confirmed", seq }` once after its
    catch-up (`sources-synced`) and then each time `seq` moves forward; the
    canvas has the same message.
  - **What triggers the refresh**: `startRefreshLoop` in
    `@valbuild/react/stega`, the one loop both providers and the scenario
    world run. One refresh per confirmed `seq` (a version told twice, or late,
    is one); at most one in flight where the refresh says when it is done
    (TanStack's `router.invalidate()` promise -- a version confirmed meanwhile
    is ONE more refresh after it), each time where it cannot (Next's
    `router.refresh()`). The first `confirmed` is the connection: the page
    refreshes for it only if the catch-up moved what it holds
    (`ValExternalStore.receive`'s answer), i.e. its render was behind the
    Studio's. Draft mode switching refreshes at once (`refresh()`). No timer:
    the loop has none.
  - **What the page reports and what the Studio sends.** The page reports
    the modules it was rendered with a draft of (`draftHolds`): on the
    overlay's `draftMode` event (`val-overlay-spa`, read by `Overlay.tsx` into
    `ValOverlayEmitter`'s `pageHolds`) and on the canvas's `ready`
    (`holds`). The catch-up (`startCatchUp`, shared by the overlay and the
    canvas's `useValCatchUp`) sends those modules as well as the pending and
    published ones, so a draft discarded (or published) before the Studio
    connected is replaced rather than kept (S28, in `sync`, which fails
    without the report). Paths, not versions: the relay's
    reads carry `version: null` until phase 5, so "what differs" is decided
    on the page by content (`receive`'s `deepEqual`), and a module that did
    not move costs nothing. Left out until then: a held module whose
    `.jsonValues()` entries the Studio has not loaded -- it would go as
    markers the page fills from its bundle, over entries its server read
    filled from the server.
  - **S24b, the early `sources-synced`, fixed.** `onceInStep` replaces
    `onceBaseAligned`: the base aligned AND the chain it aligned to fetched
    and applied (`PatchStore.chainSettled`, woken by `patch:chain` and
    `patch:head`), with the five second fallback for a server that answers
    nothing kept. `sendPendingSources` resolves when every module has been
    handed over, and `sources-synced` follows it. What it uncovered: with the
    catch-up now naming the pending module, a module whose touched entries
    were still markers went out as markers and the page filled them from its
    (older) bundle -- the matrix's "a page opened after a publish", on http.
    `emitModuleSource` now holds any module back until the entries its
    patches touch are loaded (it did so for publish-marked entries only).
  - **Next's `draft` prop** (additive): `ValProvider` takes an optional
    `draft` of the shape TanStack's takes. The store is seeded on both sides
    (`createDraftStore`), draft mode starts known, `sources-synced` starts
    true, `window.__VAL_BASE__` is set, and the edit tags are left out of the
    server render and the hydration render (`useEncodesEditTags` and
    `useHydrated`, as TanStack's). `ValDraft`, `isDraft`, `createDraftStore`
    and `draftHolds` moved to `@valbuild/react/stega`; `@valbuild/tanstack`
    still exports `ValDraft`. Wait 3 is fixed on Next for a page that passes
    it (`ValNextProvider.draft.test.tsx`: the server render and hydration
    find a route only in the draft, with no hydration mismatch). **Not
    added:** a `fetchValDraft` in `@valbuild/next/rsc` to fill it -- a public
    API change beyond the prop, so it waits for a decision (see Public API).
  - **Deleted:** `safetyRefresh.ts` and its test in both packages,
    `SAFETY_REFRESH_MS`, `SAFETY_REFRESH_WINDOW_MS`, `shouldSafetyRefresh`,
    the 500 ms throttle (`REFRESH_INTERVAL_MS` and its poll), TanStack's
    `refreshLoop.ts` and Next's inline copy of it, `VAL_EDIT_LANDED` and the
    edit counter in both providers, TanStack's `draftStore.ts` (moved),
    `onceBaseAligned`, `useValBaseAligned`, `useValPendingSourceSnapshot` and
    the canvas's own catch-up effect (now `useValCatchUp`), and S05's "why"
    pin.
  - **Found on the way:** fs mode counted an empty store's build at the
    first read AFTER the first write, so a fresh project's first edit moved
    `seq` twice, which B08 counted as a second refresh. An empty store now
    counts the instance's build when it is first read.
  - **Scenarios:** S05 passes in memory, fs and http (nothing is re-read
    while the write is held, one refresh after, none in a minute); S24b is a
    passing test; S28 (new) pins the page's report; S22 converges without its ten second wait; B08 counts
    refreshes (one per confirmed edit, one for another editor's, none for
    connecting from the draft, one for connecting without it, none on the
    clock). Wait 3 without the `draft` prop stays `test.failing` (it is the
    case the prop exists for). The world drives a TanStack page; Next's
    provider runs the same `createDraftStore`, `applyValEvent` and
    `startRefreshLoop`, but has no server draft reader, so its `draft` prop
    and its refreshes are pinned by `ValNextProvider.draft.test.tsx`; the
    canvas's messages by `canvasConfirmed.test.tsx`.
  - **The flicker cases are unchanged**, and that is the design rather than
    an omission: S26 (`overlayAfterBuild`, the overlay's `/stat` answered by
    the previous build) needs the Studio to know which of two builds' bases
    is newer before it relays one -- the manifest's versions, phase 7 (fixed
    in fs and memory in phase 7's first part, on the server rather than in
    the Studio; see that entry); S27
    (the browser running the previous build's client code) happens at
    hydration, before any overlay exists, and is home's loader's pinned
    `app.js` fallback -- decided: fixed after phase 9, as its own change in
    home; S16 (the schema dialog after a
    deploy) is phase 9's.
  - **Public API:** one addition, Next's optional `draft` prop. The overlay's
    `val-event`s (`confirmed`, and `holds` on `draftMode`) and the canvas
    messages (`confirmed`, `ready.holds`) are between Val's own packages,
    optional both ways: a bridge or a Studio of the release before ignores
    what it does not know (a page then refreshes for nothing, so the two
    have to be the same release -- they are served by the same app).

- **The Studio on the view** (phase 5, 2026-11-02). The Studio reads
  through THE engine (`applyPatchRecord`, phase 2's), at a version it
  computes itself. The pieces:
  - `packages/ui/spa/stores/studioView.ts`: `chainSource` (the base the
    Studio holds -- bundle, `__VAL_BASE__` or BaseAlignment's -- with the
    part of the chain the server has, replayed with the engine) and
    `withLocalEdits` over it (what this Studio wrote that the server has not
    confirmed: `PatchStore.isPending`). Both keep their results in a
    `VersionRing`, the last two versions per module, by the ids they were
    computed for: a keystroke extends the newest by its one patch, a
    confirmation finds the same version kept (the confirmed chain is the
    optimistic one), and a discard of the newest patch is the version before
    it. `viewOf` is the module as a field reads it: the engine's source with
    each `.jsonValues()` entry whose content is known in place of its marker
    (an entry the chain wrote; one it edited, whose held ops are resolved on
    the base entry once it is read, by the newest held op so typing into an
    entry costs one op per keystroke; one it never touched, from the base).
  - `SourceStore` on top keeps its API and its rules about fields (`peek` and
    `get`, wake-ups per path, a field never woken by its own edit). It holds
    the base, the base entries read and the chain, and one view per module,
    made in ONE place (`refresh`). `peek` is reference-stable BY KEY (the
    view, the schema, the revision and the entry fetches: each replaced in
    one place), not by recompute-and-compare. After a recompute (a drop, an
    intake, an entry read, a publish) readers are woken where their read
    moved, by `===` (risk 5); a patch applied still wakes by its paths. Its
    version is `SourceStore.versionOf`: hashed when a schema or a base
    arrives and once per patch applied, never on a read.
  - Three choices that differ from the plan's sketch, each for a reason:
    (1) a patch that does not apply is PASSED OVER and the rest apply, where
    the server's `applyChain` stops -- every such patch is discarded by the
    Studio (`discardUnapplicable`), so the two agree once the discard lands,
    and stopping would hold every later edit behind it; the version names
    what applied. (2) The engine reads the schema only for where
    `.jsonValues()` records are (`engineSchemaKey`), so a kept version is
    reused across a code change that does not move them, under the new
    schema's version: the content's objects stay, nothing repaints, nothing
    is relayed. Without it the Studio relayed every module again after a
    code change, stamped with a schema the page's (old) code does not have,
    which the matrix's "a code change after an upload" cells caught as
    "never with another schema". (3) A publish (`promotePublished`) bakes
    the published patches into the base WITHOUT their `file` ops: the files
    are where their paths say now, and a `patch_id` left in the base would
    point a field's URL at a patch that is gone. When everything shipped and
    carried no file the base IS the shown content, so nothing repaints (the
    revision does not move, as before).
  - **The file patch ids come from the one model.** The engine marks
    `patch_id` where a file lands, in the Studio's source as in the
    server's, so the relay sends the store's own object.
    `useFilePatchIds` (`PatchStore.filePatchIds`) and `Internal.mediaUrl` are
    unchanged; a field that picked a library entry uploaded in a pending
    patch gets it through `fillFromGallery` from the library's entry, where
    the engine put it (L1).
  - **Versions on the relay.** `source-update`'s `read` (and the canvas's
    `sourceUpdate`) carries the Studio's `ModuleVersion` instead of `null`.
    The page's store compares by it (`ValExternalStore.receive`): two reads
    at different versions moved, without walking the module (risk 8); the
    same version is still compared by content, because a version names a
    module's source and chain and not which of its entries the Studio had
    read, and the draft a page was rendered with carries no version
    (`ValDraft` has none). The world reads a Studio's version and a relayed
    one from the product now, so "same version, same value" holds the
    Studio's versions to the server's: B01 asserts the version a Studio
    shows an edit at before the server has it is the one `GET /manifest`
    answers after.
  - **Phase 4's leftover, fixed:** a held `.jsonValues()` module whose
    entries the Studio has not read is sent in the catch-up. The Studio's
    view knows exactly which entries differ from a page's bundle -- the ones
    the chain touched (the engine's entry states, renames included) and the
    ones a publish marked (`Internal.isJsonFromServer`), the same set the
    server's draft read fills (`withDraftJsonEntries`) -- and the relay holds
    the module back until those are read (`SourceStore.entriesToRelay`);
    every other entry is a marker on both sides. S28's `.jsonValues()` form
    (`sync`) failed before the change.
  - **Deleted:** `SourceStore`'s own patch rules (`applyPatch(deepClone(...))`
    in `applyEntries`, `storePatched`, `replayChain`, `chainTouchesEntry`,
    `unloadedEntriesOf`, the published realm's own apply loop),
    `substitutedSource` and `substituteJsonEntries`, the patched realm's
    `sources` and `jsonEntries` maps, `withFilePatchIds` and its test,
    `samePeek` (peek stability by recompute-and-compare), the
    `source:substitute-json-entries` work kind, and `discardUnapplicable`'s
    "uncertain" branch, which kept a patch into an unloaded entry because it
    failed against the marker -- the engine holds such an edit instead.
  - **Budgets** (`budgets.scenario.test.ts`): B01 and B02 in the Studio, one
    engine apply per keystroke (risk 2), no module cloned (it was one per
    patch), the root's two references copied (`engine:clone-bytes`), one
    version hashed; B06 the same in the Studio as on the server (the title's
    root, then one item of 200 copying its path); B04 no hash in the Studio
    on a read either; B05 one link on the server and one in the Studio; B09
    (new) a Studio keeps two versions of a module after forty keystrokes
    (the heap guard, risk 9) and a discard of the newest edit applies
    nothing. `world.expectWork` counts the server's work, each Studio
    reports its own through its activity channel (`version:hash`,
    `engine:clone-bytes`), since both run in one process.
  - **Measured** (`scenarios/measure/results.md`, "Phase 5"): a keystroke in
    a 5 MB module went from about 100 ms to about 19 ms, linear in the
    module's ROOT now (the engine copies the root of a record of 40,000
    entries), not in its size.
  - **Public API:** unchanged. The relay's `read.version` is between Val's
    own packages, and optional both ways (a page of the release before reads
    `source`; a Studio of the release before sends `null`).

- **Phase 7, the parts phase 6 does not block** (2026-11-03). Phase 6 waits
  for the 128 MB check on a deployed loader (decision 5), so phase 7 was
  split by what it needs from it; the analysis is
  [Phase 7 without phase 6](#phase-7-without-phase-6), below the phases
  table. Built:
  - **A previous build still answering names the newest build's base**
    (S26, in fs and memory mode). There the patches are the STORE's,
    relative to what the newest build evaluated (the files on disk, the
    modules hot reload brought), so `ValOps.chainBaseSha` -- the base a
    `/stat` says its chain belongs on -- is the newest instance's made in the
    process for the same root or patch store, by when it was made, not when
    it first answered (an old instance first asked after the new one is
    still the old one: counting by first answer was tried and is wrong).
    `/stat` answers it and compares it with what the Studio echoes, or a
    Studio parked on the old instance would be told "changed" on every
    poll. The Studio holds that base already, so `BaseAlignment` fetches
    nothing and the overlay relays nothing old. It was not done in the
    Studio, as phase 4's entry guessed ("the Studio tells which base is
    newer"): `seq` does not order two builds (the old one answers at the
    newest `seq` too), and the Studio cannot tell which build its own bundle
    is; the answering server can, and the fix is to stop it naming a base
    its chain is not relative to. **On http** the content service answers
    each build with the patches THAT build does not contain, so the previous
    build's own base is right for its chain, and only the content service
    knows a newer build is live -- built there (below), and now passing.
  - **S26 on http** (with valbuild/home's live build, PR #371). Every
    `applicable/patches` call reports this build's base (`sources_sha`),
    which home files under the build it asks as (`build:<VAL_BUILD>`, else
    `commit:<sha>`); the answer names the build home last counted live
    (`liveBuild`: its deployment, version, reported base, and whether the
    caller went live BEFORE it). `/stat` alone asks `relative_to=live`: a
    previous build is answered at the live build's position
    (`relativeTo: "live"`) and names that build's base
    (`OrderedPatchesMetadata.chainBase`), and its socket nonce asks the
    same (`relativeTo`), so the socket's chain is the one `/stat` named. A
    build home has not heard went live is the NEWEST, never told to name
    the one before it. The mock content host does the same, and the world
    names each http build (`publishBuild`), reports it live as the platform
    does (the first one too), and opens a page once that report landed.
  - **The code tools' `projectSource` by version** (home's `ETag` on
    `GET /v1/project-source`: the sha256 of its answer; 304 to
    `If-None-Match`). The publish proxy carries both (`/publish-api` GET:
    `If-None-Match` in, `ETag` and the 304 out; `ValOpsHttp.callPublishApi`),
    and the code tools read through `createProjectSourceReader`
    (`@valbuild/shared/publish`), which asks on every call with the tag it
    holds: a publish in between is seen, and the whole source is sent only
    when it changed (`projectSource.scenario.test.ts`).
  - **Staged schemas, home's half.** A staging records `staged:<inputs>` as
    every staged module's schema, and the overlay says which modules are
    staged (`VAL_OVERLAY`'s `staged`: module file path to
    `staged:<inputs>`); the mock content host serves the same. Reading it
    (versioning them `staged:`, `layered` reading them as pending) is
    phase 9's.
  - **The manifest answers "since `seq` N"** (`GET /manifest?since=N`, with
    the held manifest's ETag as `If-None-Match`): the modules whose version
    moved, `since: N` on the answer; whole when the instance did not answer
    that manifest (it keeps its last four: `ValOps.rememberManifest`,
    `manifestSince`), for another build, or for a seq that does not match its
    ETag. The ETag is in the body too (`tag`): the Studio reads through
    `ValClient`, which hands over bodies, not headers. Optional both ways. Its
    product reader is `manifestSource`, which waits for phase 6; the world
    reads it (`world.manifest(since)`), and B10 budgets it (a quiet project:
    304; one edit: one module, nothing hashed).
  - **Deleted:** the code tools' `projectSource` memo (`useAI` held a
    publish client for the hook's life; `createStudioPublishClient`'s own
    memo stays, for the publish flow, which is one deploy by design). The
    rest of phase 7's row is replaced by phase 6's module endpoint, and
    waits with it. The "why it flickers" pin of S26 went, in memory and fs,
    with the fix it pinned the absence of.
  - **Scenarios:** S26 passes in memory, fs and http (no old title, no
    `PUT /sources/~` from the overlay). S16 is unchanged: it is phase 9's (the dialog), and nothing
    here moves it. B10 is new. B01-B09 and the content-shape matrix pass.
  - **Public API:** unchanged. The wire: `/stat`'s `sourcesSha` keeps its
    meaning (the base its chain is relative to) and is now true in fs,
    memory and http; `/manifest` gains an optional query and two optional
    fields; `/publish-api` GET carries `If-None-Match` and `ETag`. To
    content, all optional both ways: `sources_sha` and `relative_to` on
    `applicable/patches`, `relativeTo` on the socket nonce (a content
    service of the release before ignores them; a Val of the release before
    sends none, and is answered as before).

**Decided on 2026-11-01**, beyond what the sections below say:

1. **Hosted layers are covered by feeding them in** (S06, S20, S21): Val's
   server in http mode against the e2e mock content host for patches, with
   the same content version and proposal snapshot handed to the server and
   to the page, as the platform hands them over. The mock host gets proposal
   WRITES (saves, stagings) only when wiring code mode needs them. The mock
   host is made callable in-process for this (it only listens on a port today).
2. **The findings that are plain bugs are fixed now**, not left to the
   phases: a whole `.jsonValues()` record read in draft mode showing published
   entries (S17), the overlay leaving out another editor's entry edit (S17), a
   module whose code throws disappearing silently (S12), the error fallback
   giving visitors edit tags (S25), and a removed module staying in the Studio
   (S13). They are fixed on this branch, where the scenarios that pin them
   live. Fixed so far: the whole-record read (F1), the overlay leaving out the
   entry edit (F2), a picked library file's draft url (L1), a module
   whose code throws (S12), a removed module staying (S13), and the
   error fallback giving visitors edit tags (S25).
3. **Code mode can be turned off, and turning it off discards nothing**: see
   "Code mode", below.
4. **Code mode is shared; the view is each person's**: see "Code mode", below.
5. **The Node heap cap is enough for now**; one probe on a deployed loader
   comes before phase 6 fixes the head's budget.

**Next, in order:**

1. Finish phase 0: the content-shape grid (`.jsonValues()`, image, file and
   video libraries, plain media fields, against every operation and reader),
   the draft-read numbers, S24 and S25, and the hosted layers (decision 1).
2. Fix the plain bugs (decision 2), and then the grid's failing cells, after
   they have been discussed.
3. ~~Wire code mode onto the UI #1010 added~~ (done; see "Built"). S10b's
   local form waits for phase 9 (an edit the server cannot apply yet is held, not deleted).
4. Phases 6 to 9 (2 to 5 are built, and of 7 what 6 does not block; the
   rest of 7 is listed under [Phase 7 without phase 6](#phase-7-without-phase-6)).
   Left from phase 5: the draft a page
   is rendered with carries no versions (`ValDraft`), so a page's first
   relay of each module is still compared by content and the page reports
   the modules it holds by path, not by version -- a `versions` field on
   `ValDraft` would close both and is an addition to a public type, so it
   waits for a decision; entries have no versions of their own (phase 6),
   so two relays at one version are compared by content too; `entriesStatus`
   and `allEntriesProgress` are still stable by recompute-and-compare (they
   are not `peek`, and are cheap); the confirmed boundary between
   `chainSource` and `withLocalEdits` decides nothing yet but which kept
   version is extended -- it matters in phase 7, when `chainSource` becomes
   the server's answer. Left from phase 4, and done after phase 5: Next's
   `fetchValDraft`, returned from `initValRsc` (decided), on the
   `readDraftChanges` TanStack's now reads through too; `examples/next`'s
   root layout passes it, and `uncommitted-routes`' single-module case runs
   on both apps. Left from phase 3: `fetchValDraft` still
   reads the tree and the entries itself (through the same functions as
   `serverDraftSource`), until phase 6's head. Left from phase 2: `/stat` and the manifest
   still name a module's whole chain where `/sources/~` names where it
   stopped (they do not apply patches, so they cannot know); `/sources/~`'s
   `patches.applied` still lists a patch that failed.

## The goal

1. **The same version shows the same content everywhere.** The Studio, the
   page's server-read content and the page's hooks agree, or know they do not.
2. **No surface goes back.** Once a surface has shown an edit it never shows
   an older version, unless the chain really went back (a discard), and then
   it moves forward to the content without the edit.
3. **Content is never read with a schema it was not made for.** A code
   change is a version change, not new content quietly read with old code.
4. **Up to date, and cheap.** Changes arrive on events, not timers. A draft
   read costs what was edited, never the size of the site, and fits in a
   128 MB isolate.
5. **Testable with high confidence.** Every scenario sets up the environment
   it runs in, and every scenario is checked against the same invariants and
   the same budgets of work, so an edge case is a script of actions rather
   than new assertions.

## Why there are so many readers

Each reason is still true, and the design keeps serving it:

| Reason                                                                                    | What it forced                                                                |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Typing cannot wait for a round trip                                                       | The Studio applies patches itself (`SourceStore`)                             |
| Schemas hold the author's closures (`validate`, `preview`), which cannot be sent anywhere | The schema instance always comes from the bundle, in the realm that runs it   |
| Server components and loaders decide `notFound()` and `<head>` before a browser exists    | Draft reads on the server (`fetchVal`), each with its own private `ValServer` |
| Content-only publishes and proposals                                                      | Content can be newer than the build: snapshots, `__VAL_BASE__`, BaseAlignment |
| One linear patch chain, so two writers do not 409 on every keystroke                      | The parent comes from `/stat`, with retries and verification                  |
| The edge lags, and builds deploy per location                                             | The Studio's bundle and the build answering `/stat` can be two builds         |
| Large `.jsonValues()` records                                                             | Lazy entries, loaded and invalidated on their own path                        |

## What is wrong today

- **Code and schema always come from a build; content comes from one of
  about seven places**: the bundle, the content version, the proposal's
  overlay, BaseAlignment's fetched base, patches the server applied, patches
  the browser applied, and history. Nothing names the pair, and the one check
  (`SchemaFreshnessWatch`) runs in the Studio only, and answers with a modal
  that reloads the page, which code mode, where schemas change with every
  build, cannot live with.
- **`fetchVal` and `useVal` repeat the same seven steps, four times.** Draft
  mode, where modules come from, which source wins, `.jsonValues()` entries,
  what to wait for, edit tags and errors are each written separately in
  Next's and TanStack's server and client readers, and twice more in the
  single-entry readers (`withJsonValuesEntries`, `draftJsonEntry`,
  `useDraftModuleSource`, `jsonEntryPromiseCache`).
- **Patches are applied by four implementations**: `SourceStore.applyEntries`,
  `ValOps.getSources`, MCP's `loadState` and `/save`'s `prepare`. (Since
  phases 2 and 5 every read applies them with one engine; `/save`'s rewrite
  of the `.val.ts` text stays its own, by design.) The first two
  already disagree: the server skips an edit inside a `.jsonValues()` entry and
  writes `patch_id` into the source where a file lands; the Studio applies
  entry edits to the substituted module and stamps `patch_id` later, in the
  relay (`withFilePatchIds`).
- **A process holds up to four `ValOps`**, each with its own memo that only
  `/save` moves, and only for the instance that handled it: the API route,
  Next's RSC readers, TanStack's `initValContent` and MCP.
- **A draft read costs the whole site.** `fetchVal` in draft mode answers
  `PUT /sources/~` for every module and previews and validates all of them on
  every request (`ValServer.ts:2348-2373`). home measured validation at about
  5× the content's size in memory, and about 15 MB of content crosses 128 MB
  in an isolate (`docs/plans/upgrades-v2.md` in valbuild/home). That path has
  not been measured in an isolate; phase 0 does.
- **The page refreshes before the server has the edit**, and a safety refresh
  every 10 s catches it (`architecture/quirks.md`). (Fixed in phase 4: the
  refresh follows "confirmed", and the safety refresh is gone.)
- **One Next page can show two versions**: server components the server's
  draft, client hooks the bundle until the overlay sends content.
- **Caches nothing invalidates**: the per-instance server memo,
  `jsonEntryPromiseCache`, and `projectSource` in the assistant's code tools.

Found on the way and not fixed here (each is its own small PR):

- `fetchVal`'s error fallback stega-encodes for every visitor, because it
  drops `disabled` (fixed as S25; the fallback itself is gone since phase 3).
- `/stat` sends `jsonEntriesSha` and nothing reads it.
- Compare with the site reads `/proposal-site-sources` with a raw `fetch`,
  not through `ValClient`.
- Staging a `.val.ts` in a proposal records its new Source with the previous
  schema's sha (`stagedModuleRows` in valbuild/home).
- MCP is not given the content version or the proposal's snapshot.

## The design

### 1. A version, per module, with the code in it

The newest patch cannot be the version, because the chain changes under it
(a discard in the middle leaves the newest patch where it was and changes the
content). And once code can change, the version has to say which code the
content belongs to. Each kind of change moves exactly one part:

| What changed                                      | Example                               | What moves                                                  |
| ------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------- |
| A module's schema                                 | a field added to `home.val.ts`        | that module's `schema` (and `base` if its literals changed) |
| A module's content written in code                | the literal in `c.define(...)` edited | that module's `base`                                        |
| A `.val.json` entry file                          | an entry edited on disk               | that entry's `base`                                         |
| Code that is not content: components, routes, CSS | a new section component               | only `build`: the page reloads, nothing is refetched        |
| How patches are applied                           | `@valbuild/*` upgraded                | the engine, part of every `schema`                          |
| Content published without a build                 | a content-only publish                | `base` of the modules it published                          |
| An edit, a discard, a publish                     | typing in the Studio                  | that module's `chain`                                       |

```ts
// packages/shared/src/internal/content/version.ts
export type ModuleVersion = {
  /** sha(engine + serialized schema): what the content is read and patched with. */
  schema: string;
  /** sha(the module's base source): from the build, a content version or history. */
  base: string;
  /** A fold of this module's patch ids, in order: IDENTITY of the chain. */
  chain: string;
};

export type ProjectVersion = {
  /** The build serving it: buildInputId when hosted, a hash of the module files in dev. */
  build: string;
  /** ORDER only: bumped by every write, delete, publish and new build. */
  seq: number;
};

export function extendChain(prev: string, id: PatchId): string {
  return sha256Hex(`${prev}\n${id}`);
}

/** The address of a module's content. Never changes meaning. */
export function moduleKey(path: ModuleFilePath, v: ModuleVersion): string {
  return `${path}@${v.schema}.${v.base}.${v.chain}`;
}
```

Three questions, three answers: _is this the same content?_ is `moduleKey`;
_is this answer newer?_ is `seq` (the content service already bumps
`headVersion` on every write, delete and commit; fs mode gets a counter in
`.val/patches.seq` under the existing `patches.lock` -- beside the lock, not
in `.val/patches/`, which delete-all and reset rename away -- and memory mode
one beside `announceChange`); _what does my next write name as its parent?_
stays `headPatchId`.

The Studio can compute the version of its own optimistic content, because
`chain` is a fold of ids it holds. When the server confirms the same chain the
keys are equal and nothing re-renders.

Today's SHAs are folds over the whole project (`computeSchemaSha`,
`computeSourcesSha`). They become per module, and the fold over them is what
tells a reader that something moved.

### 2. The store: one address, immutable values, tiers

Content at a version never changes, so a store of modules by `moduleKey` needs
no invalidation, only eviction. Every place uses the same store, with the
tiers that fit it:

```ts
// packages/shared/src/internal/content/moduleStore.ts
export type StoredModule = { version: ModuleVersion; content: ModuleContent };

export interface ModuleTier {
  readonly name: string; // "memory" | "bundle" | "origin" | …: goes into test frames
  get(key: string): StoredModule | null | Promise<StoredModule | null>;
  put?(key: string, value: StoredModule, bytes: number): void;
}

/** Asks each tier in turn; what a slower tier answers is written to the faster ones. */
export function tiered(tiers: readonly ModuleTier[]): ModuleTier;

/** Bounded by bytes; keeps the last N versions per module path. */
export function memoryTier(opts: {
  budgetBytes: number;
  lastPerModule: number;
}): ModuleTier;

/** The build's own modules, free: answers only keys whose version is the bundle's. */
export function bundleTier(valModules: ValModules): ModuleTier;
```

- **A base is a version with an empty chain.** The same store holds both, so
  "the base" stops being a separate concept with its own path
  (`__VAL_BASE__`, BaseAlignment's fetched base, the snapshot).
- **The last N versions per module** are a small ring per path inside the
  memory tier's byte budget. N = 2 covers the current version and the one
  before it (a discard, an answer that lands late). Older ones are recomputed
  from their base and chain.
- **`.jsonValues()` entries are stored as modules of their own**, under the
  record's schema, so a large record is not copied because one entry changed.

| Place                      | Tiers, fastest first                                                       |
| -------------------------- | -------------------------------------------------------------------------- |
| Val's server, node         | memory → bundle → the head computes from base + chain                      |
| A site's isolate (128 MB)  | memory (budgeted) → bundle → content version (today's handover) → the head |
| The content service (home) | blobs by `source_sha` / `schema_sha` (`val_module_versions`, exists)       |
| The Studio                 | memory → bundle (a prefill) → origin: **its own server, one endpoint**     |
| The page in the browser    | the overlay (reads from the Studio) → bundle                               |

A Cache API tier in the isolate, to keep the head across isolate restarts, is
left out unless phase 0 shows restarts are frequent enough to matter.

### 3. One engine

One function turns a module and a patch into a module, in `@valbuild/shared`
so it runs in the Studio, in Val's server and in the demo's in-tab server:

```ts
// packages/shared/src/internal/content/applyChain.ts
export type ModuleContent = {
  source: Json;
  /** `.jsonValues()` entries: content when loaded, ops waiting when not. */
  entries: Map<string, { content: Json } | { waiting: Operation[] }>;
};

export function applyPatchRecord(
  module: ModuleContent,
  record: PatchRecord,
  schema: SerializedSchema,
):
  | { status: "applied"; module: ModuleContent }
  | { status: "failed"; patchId: PatchId; message: string };
```

It owns the rules today's two engines follow differently: where a file's
`patch_id` lands (the field's path plus `nestedFilePath`), what an edit inside
an entry does (applied to the entry, or held until it loads), what a whole
entry added does (a marker in the module, content in the entry), and that a
module's chain stops at its first failure.

It applies copy-on-write along the patch's path instead of today's
`applyPatch(deepClone(module))`, so a patch costs the depth of its path rather
than the module's size, and an unchanged subtree keeps its identity (which
makes "did this path change?" a `===`). `stores.md` records a copy-on-write
bug in `.jsonValues()` substitution that took a page down, so this gets its
own conformance cases.

Callers: the Studio's local edits, the head, MCP, and `prepare`'s
`moduleVersions` (what content history records). `/save`'s rewrite of the
`.val.ts` text stays its own thing: it changes text, not content.

### 4. One way to load: sources, `layered`, `resolveVal`

Only two things differ between readers: **where the data comes from** and
**how they wait** (`await` on the server, `React.use` in a component, `peek`
then `get` in the Studio). Everything else is shared.

```
          fetchVal (server)            useVal (browser)             the Studio
                │                            │                          │
 differs:       │ request env                │ provider env             │ manifest + store
                ▼                            ▼                          ▼
 sources: [serverDraft, snapshot,   [overlay, seeded,          withLocalEdits(
           bundle]                   snapshot, bundle]           [manifest, bundle])
                └────────────────────────────┼──────────────────────────┘
 the same:                     layered(sources)     which source wins, the schema rule
                               planOf(selector)     which modules and entries
                               resolveVal(...)      → ready (with versions) | pending
                └────────────────────────────┼──────────────────────────┘
                ▼                            ▼                          ▼
          await, resolve again      React.use, render again    SourceStore.peek / get
```

Every source answers in one shape:

```ts
// packages/react/src/read/source.ts
export type ModuleRead =
  | { status: "ready"; version: ModuleVersion; source: Json; from: string }
  | { status: "pass" } // no say here: ask the next source
  | { status: "pending"; ready: Promise<void> }; // will have a say: wait

export interface ContentSource {
  readonly name: string;
  module(path: ModuleFilePath): ModuleRead;
  entry(path: ModuleFilePath, key: string): EntryRead; // the same, plus "gone"
  subscribe?(
    paths: readonly ModuleFilePath[],
    onChange: () => void,
  ): () => void;
}
```

The sources:

- `bundleSource(valModules)`: always has a say. Entries are its own
  `import()`s, kept by version (which replaces `jsonEntryPromiseCache`).
- `snapshotSource(snapshot)`: the platform's content version and proposal
  saves, for the modules it has.
- `serverDraftSource(runtime, session)`: the head, in-process, on the page's
  server in draft mode. Unpatched modules pass, so the bundle answers them.
- `overlaySource(store, state)`: the browser's store, fed by the Studio. The
  three suspend gates (`quirks.md`, "`suspend` is three waits") become its
  states: pass until hydrated or with draft mode off, pending while draft mode
  is unknown or while the Studio has not sent everything, ready for what it
  holds, pass for what the Studio says it has nothing for. `ValProvider`'s
  `suspend` prop keeps its meaning: with it, a reader waits on `pending`; without
  it (the default), `pending` is treated as `pass` and the next source answers,
  which is today's behaviour of showing published content until the draft
  arrives. Nothing suspends that does not suspend today.
- `seededSource(draft)`: what the server read for this page, so SSR and
  hydration agree.
- `manifestSource(manifest, store)`: the Studio's, below.

`layered(sources)` is the only place that decides which source wins (the
first that does not pass), and the only place that applies the code rule:

```ts
// in layered: content is only read with the schema it was made for
if (r.status === "ready" && r.version.schema !== ownSchemaVersion(path)) {
  return { status: "pending", ready: codeChanged(path, r.version.schema) };
}
```

`layered` also gives `revision(paths)`: a string that changes exactly when a
read would, built from the keys that already exist. `useSyncExternalStore`
compares it with `===`, so reference stability comes from versions rather
than from memoising objects.

`resolveVal(selector, env)` is what happens after loading, for every reader:
it reads the modules and entries `planOf(selector)` names from the view,
fills `.jsonValues()` records, returns `pending` with one promise if anything
is pending, and otherwise `stegaEncode`s and returns the value with the
version and source of every module it read. The single-entry readers
(`fetchValKey`, `useValKey`, the route readers) are a different plan through
the same function.

The readers are then what is left to differ:

```ts
// server
export function initFetchVal(env: { forRequest(): Promise<ReadEnv> }) {
  return async function fetchVal<T extends Resolvable>(
    selector: T,
  ): Promise<ResolvedVal<T>> {
    const readEnv = await env.forRequest(); // cookie, session: the only server-specific part
    for (;;) {
      const r = resolveVal(selector, readEnv);
      if (r.status === "ready") return r.value;
      await r.ready;
    }
  };
}

// browser
export function useVal<T extends Resolvable>(selector: T): ResolvedVal<T> {
  const env = useReadEnv(); // the provider's: layered([overlay, seeded, snapshot, bundle])
  const plan = planOf(selector);
  React.useSyncExternalStore(
    React.useCallback(
      (cb) => env.view.subscribe?.(plan.modules, cb) ?? (() => {}),
      [env, plan],
    ),
    () => env.view.revision(plan.modules),
    () => env.view.revision(plan.modules),
  );
  const r = resolveVal(selector, env);
  if (r.status === "pending") React.use(r.ready);
  return r.status === "ready" ? r.value : unreachable();
}
```

`encode` (edit tags) is part of the env, decided once from draft mode, so an
error on the way can no longer drop it.

### 5. The Studio loads everything from one place

The Studio asks its own server two things: **what** (the manifest) and **the
content** (modules by address). The bundle is a prefilled tier, used when an
address matches, and the place schema closures come from; it is no longer a
second source of content.

```ts
// GET /api/val/manifest: what /stat answers, per module. Own ETag, and "since seq N".
type Manifest = {
  project: ProjectVersion;
  modules: Record<ModuleFilePath, ModuleVersion>;
};

// GET /api/val/modules/<path>?v=<moduleKey>[&have=<moduleKey>]
// Cache-Control: immutable. With `have`, the patches from `have` to `v` when
// the server can, else the whole module.
type ModuleAnswer =
  | { kind: "module"; version: ModuleVersion; content: ModuleContent }
  | {
      kind: "delta";
      from: ModuleVersion;
      to: ModuleVersion;
      patches: PatchRecord[];
    };
```

```ts
// packages/ui/spa/stores/studioView.ts
const store = tiered([
  memoryTier({ budgetBytes: 64 * MB, lastPerModule: 2 }),
  bundleTier(window.__VAL_MODULES__),
  originTier(client), // GET /modules/…, with `have` from the memory tier
]);
const view = withLocalEdits(
  layered([manifestSource(manifest, store)]),
  () => patchStore.unconfirmed(), // written here, not yet in the server's chain
  engine,
);
```

`withLocalEdits` is the one layer only the Studio has, because only the
Studio writes and typing cannot wait: it applies the Studio's unconfirmed
patches with the engine on top of what the server answered, and extends the
version's `chain` by their ids. It keeps its result per (version below, ids
applied) and extends it by the new patch only.

`SourceStore` sits on top of the view and keeps what `stores.md` describes,
because those rules are about fields, not loading: `peek` and `get` (`pending`
is what `get` waits for), wake-ups per path, a field never woken by its own
edit, previews and custom validation from the bundle's schema instances. What
changes: `peek` is reference-stable by key (same version and path, same
object) rather than by recompute-and-compare.

The relay sends the page exactly what the view answered (`{ path, read }`,
built by a `createSourceRelay(view, send)` extracted from
`ValOverlayEmitter`), and the page's `overlaySource` stores it as is. The page
reports its base per module when it connects, and the Studio sends every
module whose base differs, not only the ones it has patches for.

This deletes BaseAlignment, `__VAL_BASE__`, the client's replay of other
sessions' patches, `substitutedSource` and `withFilePatchIds`.

Until the head and the module endpoint exist (phase 6), the Studio runs
today's behaviour as a source, `chainSource` (the bundle plus the whole chain,
replayed in the browser with the engine), so its consumers move onto the view
early and the later switch is one line.

As built in phase 5 (see "Built"): `chainSource` and `withLocalEdits` are
functions over the store's base and chain in `stores/studioView.ts`, not
`ContentSource`s yet -- the Studio has one source until phase 7, and nothing
reads the layering but the memo of versions (`VersionRing`) both share. The
memory tier's "last N per module" is that ring, N = 2. `SourceStore` is the
`peek` / `get` on top, and the relay hands the page its view's source with
its version.

### 6. One runtime per process, and the head

`valRuntime(valModules, config)` returns one runtime per process or isolate,
keyed on the `valModules` object so HMR makes a new one. The API route, the
draft readers and MCP all use it, so a save moves every reader. It is built
with the content version and the proposal like everything else, which fixes
MCP's base.

The runtime holds the **head**: the content at the newest chain, in the
module store. In a 128 MB isolate it only grows with what was edited:

1. An unpatched module costs nothing: the bundle tier answers with the
   bundle's own object, which the isolate holds for every visitor anyway.
2. A module is materialized when it is read and has patches, never all at
   once.
3. A discard replays one module from its base through its own patches.
4. The memory tier's byte budget (16 MB, to be measured in phase 0) evicts the
   least recently read module, which is recomputed on its next read.
5. No validation and no previews on the read path. They become their own
   requests.

One head serves every editor: draft content is not per user, and the session
only decides who may see it.

In http mode the runtime needs a cheap "has the chain moved?", `seq` alone,
from a small content-service endpoint or pushed. Today `/stat` fetches the
whole patch list on every call.

### 7. How code changes travel

| Reader     | A module's schema changed                                                                                                                                                                             | Only `build` changed |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| The Studio | `reloadCode` puts the new schema instances in place, from HMR in dev or from the build's registry entry when hosted; no dialog, no page reload ([below](#reloading-the-schema-while-the-studio-runs)) | nothing to refetch   |
| The page   | reload: its own code is the old build                                                                                                                                                                 | reload               |
| `fetchVal` | cannot happen: the runtime is the build, and a new build is a new runtime                                                                                                                             | —                    |

- **Local dev.** Editing `home.val.ts` makes a new `valModules` (HMR), a new
  runtime, and a manifest where only `/home.val.ts` has a new `schema` and
  `base`. Nothing else is refetched.
- **Code mode, before a build.** A staged `.val.ts` has text but no evaluated
  schema, so its version is `schema = "staged:<inputs hash>"`, which no reader
  has: its content is pending ("build to see it") rather than read with the old
  schema. The design tab's evaluation in the browser (`design-tab.md` §3 in
  valbuild/home) or a quick preview can give the real schema sha. Home's
  staging bug becomes impossible to write: it is a version claiming a schema
  it was not made with.
- **Code mode, after a build.** The proposal's address serves a new build, so
  a new runtime; modules whose `.val.ts` changed get new addresses, and the
  rest keep theirs.
- **A content-only publish.** `base` moves for what it published; `build`
  does not.

### 8. The page converges on the Studio

The overlay is the first source in the page's view, so a refresh that brings
an older server draft never wins over the Studio's value for that module. When
the server's render reaches the same `moduleKey`, it is the same content and
nothing changes on screen.

Server-read content (a loader, a server component) only changes on a refresh,
so the refresh has to be sent when the server has the edit, not when it is
typed: the Studio sends the page "confirmed up to this version" when
`PatchSync` has it confirmed, and the page refreshes then. That replaces the
safety refresh and its throttle.

TanStack's `draft` prop (fed by `fetchValDraft` in the app's loader) stays as it
is, and is what removes the flash of published content before the draft. Next
can get the same through an optional `draft` prop on its `ValProvider` and a
`fetchValDraft` in `@valbuild/next/rsc`: additive, and an app that does not pass
it behaves as today. See [Public API](#public-api).

## Testing

**The rule: tests replace the network, the clock and nothing else of Val's.**
The same rule `createInTabValFetch` was built on: a second implementation is
something the product drifts from while the tests stay green.

### Three levels

1. **The shared pipeline, with scripted sources.** `layered`, `resolveVal`,
   `withLocalEdits` and the engine are the same code for every reader, so an
   edge case here is tested for all of them: a pending overlay that resolves
   (and the bundle's value never shown in between), an entry that is gone, a
   module whose schema differs. Scripted sources are allowed at this level
   because `ContentSource` is the boundary.
2. **One contract per real source and tier.** Given this state, the source
   answers pass, pending or ready; a tier answers this key or nothing. For
   example: an edit the server confirmed is not applied twice by
   `withLocalEdits`, and its version is the same as the optimistic one.
3. **Scenarios: the real code, the whole world.**

### A scenario

```ts
// packages/scenarios/src/refreshRace.scenario.test.ts
describe.each(["memory", "fs"] as const)("on %s", (server) => {
  test("a refresh that lands before the write does not hide the edit", async () => {
    const world = await createWorld({
      modules: [homeVal],
      server,
      framework: "tanstack",
    });
    const studio = await world.studio("editor");
    const page = await world.page("/", {
      draftMode: true,
      in: { canvasOf: studio },
    });

    studio.reads("field", homeVal, ["title"]); // SourceStore.peek, as a field does
    page.reads("loader", (val) => val.fetchVal(homeVal).title); // the real fetchVal
    page.reads("hook", (val) => val.useVal(homeVal).title); // the real useVal, rendered in jsdom

    world.network.hold({ method: "PUT", path: "/patches" });
    studio.edit(homeVal, ["title"], "Hello world");
    await page.refresh(); // the race: the server does not have the edit yet
    world.network.release();
    await world.settle({ before: "safety-refresh" });

    world.expectInvariants();
    world.expectWork({
      "engine:apply-patch": { atMost: 2 },
      "origin:fetch-module": { atMost: 1 },
    });
  });
});
```

| Part              | Real code                                                                                                      | What the harness controls                             |
| ----------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Server            | `ValServer` + `createValRequestHandler`, memory or fs (a temp dir); http against `e2e/mock-content-host` later | the mode; one runtime shared by every reader          |
| Network           | the Studio's `createValClient`, the page's requests                                                            | hold, release, delay, reorder, fail by route          |
| Studio            | `createValSystem` with in-process schema validation                                                            | who the editor is; several editors                    |
| Page, server half | the real `fetchVal` with its request env                                                                       | draft mode on or off; a refresh is a re-read          |
| Page, client half | the real `useVal`, rendered with `renderHook` in jsdom                                                         | hydrated or not                                       |
| Relay             | `createSourceRelay`, extracted from `ValOverlayEmitter`                                                        | canvas or overlay                                     |
| Refresh loop      | `createRefreshLoop`, extracted from `ValTanStackProvider`                                                      | —                                                     |
| Clock             | jest fake timers                                                                                               | `settle()` to quiet, or stopping before a named timer |
| Code              | a new `valModules`, as HMR or a new build makes                                                                | `world.changeCode(module, schema)`                    |

`describe.each` is the lever: every scenario runs in every mode the harness
can set up. The package is `packages/scenarios`, private, because it depends on
server, shared, ui, react and tanstack together.

### The invariants

Every surface records a frame each time it shows a value: surface, time on
the fake clock, value, the source that answered, and the version.
`world.expectInvariants()` checks:

1. **Converges.** After `settle()`, every surface shows the server's version
   of every module it reads.
2. **Never goes back**, unless the chain went back (`seq` moved and `chain`
   returned to an earlier key).
3. **One version per render.**
4. **Parity.** The same versions give the same value, whether read through
   `fetchVal`, `useVal` or a Studio field.
5. **Never with another schema.** No surface shows content whose `schema` is
   not the schema it read it with.
6. **Events, not timers.** `settle({ before: "safety-refresh" })` fails if
   converging needed the safety refresh. (As built in phase 4 the safety
   refresh is deleted, so there is no timer left to stop before: the
   refresh loop has none, and S05 and B08 count the refreshes and move the
   clock on a minute to see none come from it.)
7. **No dialog about the schema.** A schema change, however often it happens,
   never stops the editor (see
   [Reloading the schema](#reloading-the-schema-while-the-studio-runs)).

A failure names the invariant, the surface, the source and the frames:

```
✕ never goes back: "loader"
    120 ms  "Hello"        from bundle        chain —
    640 ms  "Hello world"  from server-draft  chain k1
    700 ms  "Hello"        from server-draft  chain k0   ← older chain, after k1 was shown
```

Until phase 1, frames carried values only and the invariants compared
values. Since phase 1 every frame carries, per module it read, the source
that answered, its version and the schema of the code that read it, and the
invariants use them (`scenarios/src/world/frames.ts`); "one version per
render" is the one still unchecked, because a frame is one field.

### Budgets of work, counted

Performance is checked by **counting work, not timing it**, so CI can run it
deterministically. The stores already do this: `RecordingActivity` counts
`source:clone-module` and `source:apply-patch` so that "a redundant clone and
a redundant apply are different bugs". The harness reads the same channel, so
"a keystroke applies one patch, clones nothing outside its path and wakes one
field" is an assertion (`world.expectWork`). Wall-clock numbers live in phase
0's benchmark, run separately and recorded in `architecture/`.

### The first scenario, and why

A refresh that lands before the server has the edit: a known bug
(`architecture/quirks.md`) closed today by a timer, so the scenario is red on
"events, not timers" and turns green in phase 4. It needs every part of the
world (server, Studio, a page with a server half and a client half, relay,
network, clock), so a harness that can express it can express the rest. And it
is small: one module, one field, one edit.

### The scenarios after it

- A patch in the middle of the chain is discarded while the page shows it (the
  newest patch stays the same and the content changes).
- Two editors on one module; their `/stat` answers land out of order; the
  pull answers with deltas (`origin:pull-bytes` budgeted).
- A publish while the page is open in draft mode.
- A site serving a content version newer than its bundle, with an unedited
  module.
- An edit inside a `.jsonValues()` entry that neither the page nor the Studio
  has loaded.
- An upload, so `patch_id` reaches the page where the file lands.
- A schema change while the page shows an edit (`world.changeCode`): only that
  module is refetched, and nothing is read with the old schema.
- A gallery-backed field whose gallery changes (its schema names the gallery
  by path, so its `schema` must not move).

Later, the network can be driven by a seed: the same scenario under many
orders of response arrival, keeping the seed of any that fails.

## Performance risks

| #   | Risk                                                                                      | New or today?        | What to do                                                                | Budget                                 |
| --- | ----------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------- | -------------------------------------- |
| 1   | Pulling a whole module after another editor's keystroke (today only the patch comes down) | **New**              | The module endpoint answers with a delta from `have` when it can          | `origin:pull-bytes`                    |
| 2   | `withLocalEdits` re-applying every unconfirmed patch on every read                        | New                  | Keep the result per (version below, ids applied); extend by the new patch | `engine:apply-patch` per keystroke = 1 |
| 3   | Hashing on reads                                                                          | New                  | Versions are computed when content changes, never when it is read         | `version:hash` per read = 0            |
| 4   | The engine cloning the whole module per patch                                             | Today                | Copy-on-write along the patch's path                                      | `engine:clone-bytes`                   |
| 5   | Wake-ups after a pull, which does not say which paths changed                             | New                  | `===` per path, thanks to copy-on-write; or the paths from the delta      | `store:wake`                           |
| 6   | `stegaEncode` on every render                                                             | Today                | Memoize `resolveVal` per (selector, `revision`, `encode`)                 | `stega:encode` per render              |
| 7   | "Has the chain moved?" per draft request in http mode                                     | Today, cheaper after | `seq` alone, or pushed; one head per isolate for every editor             | phase 0 benchmark                      |
| 8   | The relay sending the whole module per change, compared with `deepEqual`                  | Today                | Compare `moduleKey`; send deltas later                                    | `relay:bytes`                          |
| 9   | Browser memory: every pulled version kept                                                 | New                  | The last two per module                                                   | heap guard                             |
| 10  | The manifest's size (~30 KB for 200 modules)                                              | New                  | Its own ETag and "since `seq` N"; a quiet project sends nothing           | `manifest:bytes`                       |
| 11  | The isolate's 128 MB                                                                      | Today                | The head grows with edits only; validation leaves the read path           | phase 0 benchmark                      |

Risk 1 decides the design rather than adding work to it: without the delta,
pulling makes collaboration more expensive than it is today.

## The phases

Each phase ships on its own and leaves everything working. Each adds the
scenarios it makes pass.

### Each phase deletes what it replaced

The point of the plan is fewer paths, so old and new never live side by side
longer than one PR. A phase is not done while the code it replaced is still
there; there is no flag to choose between the two, and no "remove later".

- **Behaviour first, then deletion.** What the old code did is pinned by a
  scenario or a contract test before it goes. A unit test of deleted code is
  deleted with it; a behaviour it pinned moves to a scenario first. (The rule
  "never fix an issue by changing the test file" still holds: this is moving
  what a test checks, not loosening it.)
- **What may not simply be deleted:**
  - **The public API** of `@valbuild/*`: `fetchVal`, `useVal`, the key and
    route readers, `ValProvider`, `ValModulesClient` keep their signatures. An
    export that has to go is `@deprecated` for a release first, as
    `s.imageset` was.
  - **The wire to the content service.** home deploys on its own schedule, so
    a field Val stops reading stays optional on the wire until home stops
    sending it, and a new field is optional until home sends it (as
    `headPatchId` and `headVersion` are).
  - **A deployed Studio against a newer server**, for the length of a
    deploy: a `/stat` answer keeps what an older Studio reads until the
    manifest has replaced it for a release.
- **Each phase lists what it deletes**, below, so a review can check the
  deletion happened rather than trust it.

| #   | Phase                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Repos     |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 0   | **The harness and the first scenario.** `packages/scenarios`; `createWorld` in memory and fs; `createSourceRelay` and `createRefreshLoop` extracted; the invariants and counted budgets; the refresh-race scenario (red). Measure today's draft read and a prototype head in `workerd` at 128 MB.                                                                                                                                                                                                                                                                                                                                                   | val       |
| 1   | **Versions on the wire.** `ModuleVersion` (`schema`, `base`, `chain`) and `ProjectVersion` (`build`, `seq`); per-module SHAs; `seq` in fs and memory; the manifest with its ETag; every answer and frame carries a version. No behaviour changes.                                                                                                                                                                                                                                                                                                                                                                                                   | val       |
| 2   | **One engine, server side.** `applyPatchRecord` in shared, copy-on-write; `getSources`, `getSourcesWithPatchesApplied` and `prepare`'s `moduleVersions` switched over; conformance cases pass on both engines.                                                                                                                                                                                                                                                                                                                                                                                                                                      | val       |
| 3   | **The readers on sources.** `ContentSource`, `layered` (with the schema rule), `planOf`, `resolveVal`; the bundle, snapshot, overlay and seeded sources; `fetchVal`, `useVal` and the key and route readers of both frameworks on them; the relay sends reads. Removes the duplicated copies and the error-path bug.                                                                                                                                                                                                                                                                                                                                | val       |
| 4   | **The page converges.** Overlay first; "confirmed up to this version" triggers the refresh; the page reports its bases and the Studio sends what differs; an optional `draft` prop for Next (additive); the safety refresh goes. The first scenario turns green.                                                                                                                                                                                                                                                                                                                                                                                    | val       |
| 5   | **The Studio on the view.** `withLocalEdits` over `chainSource` (today's behaviour as a source); `SourceStore` on top, reference-stable by key; `substitutedSource` and `withFilePatchIds` go.                                                                                                                                                                                                                                                                                                                                                                                                                                                      | val       |
| 6   | **The store, the runtime and the head.** `tiered`, `memoryTier`, `bundleTier`; `valRuntime` per process; the head in the store; `serverDraftSource`; `GET /modules` with deltas; validation and previews leave the read path; a cheap `seq` in http mode. Within 128 MB.                                                                                                                                                                                                                                                                                                                                                                            | val, home |
| 7   | **The Studio loads from one place.** `manifestSource` and `originTier` replace `chainSource`; BaseAlignment and `__VAL_BASE__` go; the code tools' `projectSource` keyed by version; staged schemas (`staged:<hash>`) in code mode.                                                                                                                                                                                                                                                                                                                                                                                                                 | val, home |
| 8   | **Document.** `architecture/content-versions.md`; `stores.md` and `quirks.md` updated; anything a phase could not delete in its own PR (only the wire and deprecations above), with the release it goes in.                                                                                                                                                                                                                                                                                                                                                                                                                                         | val       |
| 9   | **Reloading the schema while the Studio runs.** See [the section below](#reloading-the-schema-while-the-studio-runs): one `reloadCode(registry)` for HMR and for a new build; a registry entry per build, named in the manifest; replaced, not merged; a registry that does not load leaves the Studio on the old one; edits that no longer apply are held, not deleted; `SchemaFreshnessWatch` and its dialog deleted; and [evaluating code after a write](#evaluating-code-after-a-write): the tab evaluates `val.modules` after each staging, records each changed module's Source with its schema, swaps the schema in and tells the assistant. | val, home |

What each phase deletes (to be checked against the code when the phase
starts; the names are as of 2026-11-01):

| #   | Deleted in the same PR                                                                                                                                                                                                                                                                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | Nothing; the relay and the refresh loop MOVE out of `ValOverlayEmitter`, `ValTanStackProvider` and `ValNextProvider` into plain functions the components call. Moved, not copied.                                                                                                                                                                                           |
| 1   | Nothing: it only adds to the wire.                                                                                                                                                                                                                                                                                                                                          |
| 2   | The patch rules in `ValOps.getSources` and `getSourcesWithPatchesApplied`; the replay in `applyJsonValuesEntryPatches`; `deepClone` per patch.                                                                                                                                                                                                                              |
| 3   | `withJsonValuesEntries` (Next and TanStack), `draftJsonEntry`, `useDraftModuleSource`, `committedJsonEntryPromise`, `jsonEntryPromiseCache`; the inline source-priority arrays; the suspend gates in both `initValClient`s; the error-path `stegaEncode`; the two `useValStega` copies, which become one in `@valbuild/react`.                                              |
| 4   | The safety refresh (`safetyRefresh.ts` in both packages, `SAFETY_REFRESH_MS`, `SAFETY_REFRESH_WINDOW_MS`) and the 500 ms throttle around it.                                                                                                                                                                                                                                |
| 5   | `SourceStore`'s own patch rules in `applyEntries`; `substitutedSource`; `withFilePatchIds`; peek stability by recompute-and-compare.                                                                                                                                                                                                                                        |
| 6   | The private `createValServer` in `initValRsc` and in `initValContent`, and MCP's `createOpsResolver`; `loadDraftSources`; `createReactCacheScope` and `createTanStackRequestScope`; the per-call `/json` in the key readers; `fetchValDraft`'s extra `/patches` and `/json`; whole-tree previews and validation in `PUT /sources/~`; MCP's rebuild per call in `loadState`. |
| 7   | `BaseAlignment`; `__VAL_BASE__`; the Studio's `PUT /sources/~?apply_patches=false`; `chainSource`; the client's replay of the chain and its reconciliation of patches that vanished from `/stat`; the code tools' `projectSource` memo.                                                                                                                                     |
| 9   | `SchemaFreshnessWatch`, `StatusStore.reportSchemaOutOfDate` and the dialog; the merge in `SchemaStore.receive`; the Source-without-schema that `stagedModuleSources` sends with a staging.                                                                                                                                                                                  |

### Phase 7 without phase 6

Written 2026-11-03, when phase 6 was blocked on the deployed 128 MB check and
the decision was to go on with phase 7 where it makes sense. What each part
of phase 7 needs from phase 6 (`tiered`, `memoryTier`, `bundleTier`, the head,
`GET /modules` with deltas):

| Part of phase 7                                                                                | Needs phase 6?                                     | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The manifest's "since `seq` N"                                                                 | No                                                 | Versions are kept as content changes since phase 1; a delta is a comparison. **Built.**                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| S26: which of two builds' bases the chain belongs on                                           | No (fs, memory)                                    | The answering server knows; see the Built entry. **Built** for fs and memory, and for http with the content service's live build (below), not phase 6.                                                                                                                                                                                                                                                                                                                                                                                   |
| `originTier`                                                                                   | **Yes**                                            | It IS a tier of phase 6's store, over `GET /modules`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `manifestSource` replacing `chainSource`                                                       | **Yes**                                            | The manifest names versions, not content. On today's endpoints the content would be `PUT /sources/~`: the whole tree, previewed and validated, on every other editor's keystroke -- risk 1, which "decides the design": pulling without the delta makes collaboration dearer than the chain replay it replaces. The confirmed boundary between `chainSource` and `withLocalEdits` (phase 5) waits with it.                                                                                                                               |
| The client's replay of the chain, and its reconciliation of patches that vanished from `/stat` | **Yes**                                            | They are what `chainSource` does; they go when the server's answer (by version, with deltas) replaces it.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `BaseAlignment` and the Studio's `PUT /sources/~?apply_patches=false`                          | **Yes**                                            | A base the Studio does not hold has to come from somewhere: today the whole tree by `sourcesSha`, after phase 6 one module by its version (`GET /modules?v=` with an empty chain). Replacing one fetch of the whole tree with a per-module loop over today's endpoints is a third way to load a base, for one phase.                                                                                                                                                                                                                     |
| `__VAL_BASE__`                                                                                 | **Yes**                                            | It saves the overlay that fetch. Without it, every draft page on a site serving a content version (content published without a build: common when hosted) would cost the overlay a whole-tree `PUT /sources/~` before it relays anything. It goes when a base by version is one cheap read -- and it is in the provider files, which are shared with the page's half.                                                                                                                                                                    |
| The code tools' `projectSource` keyed by version                                               | No, but **home**                                   | There was no version to key it by: `/v1/project-source` carried none, Val's publish-API proxy carried no headers back, and the Studio knows the site's newest commit only at the site's address (`headCommitSha`), not at a proposal's, where code mode runs. **Built** with home's `ETag` (below): keyed by the answer's own tag, revalidated per call.                                                                                                                                                                                 |
| Staged schemas (`staged:<hash>`)                                                               | No, but **home** (and phase 9 for the real schema) | The server at a proposal's address cannot tell a staged `.val.ts` (code) from a content save: the overlay it is handed (`VAL_OVERLAY`: `commit`, `modules`, `files`) says neither which modules were staged after its build nor their inputs hash, and a content save rewrites the same `.val.ts` text. And a version the server marks `staged:` is only effective once the readers that read the snapshot and the Studio read versions from the server (`snapshotSource` has none; the Studio computes its own until `manifestSource`). |

**What is left of phase 7 for after phase 6**, in order: `originTier` in the
Studio's store, `manifestSource` (reading the manifest "since `seq` N") with
`withLocalEdits` over it, so `chainSource` goes and with it the client's
replay and its reconciliation of vanished patches; then `BaseAlignment`, the
Studio's `PUT /sources/~?apply_patches=false` and `__VAL_BASE__` (both
providers and `ValModulesClient`'s window type), for which the page's report of
its base per module (phase 4's `holds`, by version) is the replacement.

**What valbuild/home needed**, built there on 2026-11-03 (valbuild/home PR
#371; the contract as written for both sides is in the Built entry above):

1. **S26 on http.** On `GET /v1/{project}/applicable/patches`, an optional
   field naming the branch's live build -- the deployment
   `patches.countDeploymentLive` counted last -- with the `sourcesSha` of its
   base, and a way to ask for the chain relative to that build rather than
   the caller's (the list leaves out what the CALLER's build contains). With
   both, a previous build's isolate answers `/stat` as fs and memory now do:
   the live build's chain and base, which a Studio holding the new bundle
   already has. Absent: as today. The mock content host and
   `homeWireContract.test.ts` take both at once, when home has them.
   **Built**: `liveBuild` and `relativeTo` on the answer, `sources_sha` and
   `relative_to=live` on the request, `relativeTo` on the socket nonce.
2. **`projectSource` by version.** `GET /v1/project-source` with an `ETag`
   that names the KV write it reflects, and a 304 to `If-None-Match`; Val's
   publish-API proxy (`ValOpsHttp.publishApi`, `/publish-api`) then carries
   both headers, and the code tools revalidate per call instead of holding the
   first answer for the hook's life (`createStudioPublishClient`'s memo, kept
   for the publish flow, which is one deploy by design). **Built**: the tag
   is the sha256 of the answer, which names the write it reflects.
3. **Staged schemas.** A staging records each staged module's schema as
   `staged:<inputs hash>` (instead of the previous schema's sha:
   `stagedModuleRows`), and the overlay handed to a proposal's address says
   which modules those are (their version, or the inputs hash); Val's server
   then versions them `staged:<hash>` and `layered` reads them as pending.
   Val sends the inputs hash with the staging (`stagedModuleSources`' caller)
   once home stores it. **Built**, with one change: home computes the
   inputs hash itself (`stagedInputs`, the hash a build of the staged files
   is named for), so Val sends nothing new. The overlay's `staged` names
   every staged module file (a module new in the proposal too) with
   `staged:<inputs>`, derived from the staged files, and names the staging,
   not whether the build serving the address was made of it. Val's reading
   of it is phase 9's.

### Phase 9 without phases 6 and 7

Written 2026-11-03, when phase 6 waited for the deployed 128 MB check and
phase 7's remainder (`originTier`, `manifestSource`, BaseAlignment and
`__VAL_BASE__` going) waited for phase 6. What each part of phase 9 needs:

| Part of phase 9                                                                                     | Needs 6 or 7?                      | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An edit that no longer fits after a code change is held, not deleted (S14)                          | No                                 | The Studio knows when a module's schema moved (`SchemaStore.version`) and which patches fitted before it did; the choice is made where it deletes today (`discardUnapplicable`). What it cannot see: a patch it never saw fit (a Studio opened after the change), because a patch carries no schema version on the wire.                                                                                                                                   |
| An edit to a field the server does not have yet is kept (S10b, local development)                   | No                                 | The base under a module has to be made with the schema the Studio reads it with. `PUT /sources/~` answers each module's version since phase 1, so BaseAlignment can leave out a module the answering build evaluated with another schema, and keep the one it has -- the bundle's, made with the Studio's own code.                                                                                                                                        |
| `reloadCode(registry)`: one intake, for the first registry, HMR and staged code                     | No                                 | It is `HostStore.receive` made the only door, answering what it did (`reloaded`, with the modules that moved and went) or that it did nothing (`kept`, `does-not-load`).                                                                                                                                                                                                                                                                                   |
| A new build's registry (`/_val/modules/<build>.js`, named by the manifest) and `not-the-manifest's` | **Yes (7)**, and the builds        | The Studio holds no manifest until `manifestSource`, so it has nothing to check a registry against; and no build emits the entry (`@valbuild/tanstack-build`, served by the platform).                                                                                                                                                                                                                                                                     |
| `other-val-version` (an upgrade proposal reloads the Studio by itself)                              | **Yes**, with the build's registry | Only a build's registry can carry another Val; staged code is evaluated against the site's vendor layer.                                                                                                                                                                                                                                                                                                                                                   |
| `SchemaFreshnessWatch`, `StatusStore.reportSchemaOutOfDate` and the dialog deleted (S16)            | **Yes**, with the build's registry | Hosted, a deploy is the only way new code reaches an open Studio, and until a build's registry can be swapped in the dialog is the only thing that stops the editor working on a schema the server no longer has. Deleted without it, the Studio would go on showing the old fields over the new build's content, silently. It is already not shown in code mode, where the schema changes with every build and the staged code is now swapped in (below). |
| The merge in `SchemaStore.receive`                                                                  | --                                 | Gone already: an intake replaces (S13, phase 0's plain bugs).                                                                                                                                                                                                                                                                                                                                                                                              |
| Search and references stale for the modules whose schema moved                                      | No                                 | `schema:init` names them; validation and previews listened, search and references did not.                                                                                                                                                                                                                                                                                                                                                                 |
| The tab evaluates `val.modules` after each staging, swaps the schema in and tells the assistant     | No (where the page can build)      | `bundleValModules`, `evaluateTree` and `readValModules` exist (update with code). Only where the builder can run (`canBuildHere`), as for a build in the page.                                                                                                                                                                                                                                                                                             |
| A staging records each changed module's Source WITH its schema (`staged:<hash>`)                    | No, but **home**                   | The content service has to store and serve the schema version beside the Source; Val then sends it with the staging, and the Source-without-schema `stagedModuleSources` sends goes. Waits for home's contract.                                                                                                                                                                                                                                            |

Phase 2 can run beside phases 3 and 4. Phase 6 moves ahead of 2–5 if phase 0
shows today's draft read already crosses 128 MB. http mode joins
`describe.each` once `e2e/mock-content-host` can be started in-process.

## Open questions

- **The http-mode `seq`.** A new content-service endpoint, or pushed over the
  WebSocket? The endpoint is simpler; the WebSocket is open in the Studio but
  not in a page's server. (Phase 1 found that `headVersion` was not bumped
  by a deployment; valbuild/home now bumps it once per deployment going
  live, and S11's "a new build is counted" passes on http. Left open: a new
  build answers at the old `seq` until the service hears it went live --
  seconds for the platform's own builds, a webhook's delay for GitHub's --
  and only `build` tells those answers apart.)
- ~~**Next's server components** only change on a refresh. "Confirmed up to
  this version" covers the edit; does it also need to cover another editor's
  change, or is that the next refresh's job?~~ Answered by phase 4: it covers
  it, because "confirmed" is the server's `seq`, which another editor's write
  moves as much as one's own (B08).
- **Staged schemas.** Content under `staged:…` is unreadable until something
  evaluates the proposal's code. Whether the browser evaluation of
  `design-tab.md` §3 is in scope decides how long code mode's content waits.
- **The budgets.** 16 MB for the isolate's head and 64 MB for the Studio's
  memory tier are guesses; phase 0 replaces them with numbers.
- **React in the harness.** `useVal` is thin enough to render with
  `renderHook`; whether hydration scenarios (phase 4) live in the same package
  is open.

## Code mode: content is saved before code changes

**Decided 2026-11-01 (the user):** in a proposal in code mode, content and
code are never in two places when code changes.

1. **Entering code mode saves every pending content change** into the
   proposal (an ordinary proposal save).
2. **Before each code write** (the assistant's `write_files`), the content
   changes made since are saved first, so the `.val.ts` text the assistant
   reads and edits is the current content.
3. **Content changed in code goes with the code.** By the time code changes,
   the content is in the file text, so there are no pending patches left on a
   base the code change can move. That removes the class of bug behind the
   reverting field (S10b): an edit applied to an older base, or deleted
   because it no longer fits.

**Saves stop being commits in git (connected projects).** Today every save,
and every staging, queues the proposal's `push` job in a connected project,
which pushes a commit to `val/p/<name>` in the background (`postProposalSave`
and `proposalCode.ts` in valbuild/home; home's `docs/proposals.md`, "Saving
pushes to git"). With a save before every code write, that would be a commit
per write. Instead:

- **Saves and stagings do not push.** They stay commits on the proposal's
  content line in the content service: the proposal's history and its
  checkpoints, as today.
- **Save stays the button; the caret on its right opens a menu with Commit
  and Publish.** The split-button shape `ProposalActionButton` already has
  (a main half and a caret menu), with Save as the main half.
  - **Commit** (connected projects only) pushes the proposal as it stands, as
    one commit on `val/p/<name>`, so a developer finds it in git.
  - **Publish** commits what is not yet on the branch and merges, as one step.

This reverses home's 2026-10-07 decision ("a save pushes to the proposal's git
branch"); home's `docs/proposals.md` changes with it.

### Decided (2026-11-01)

1. **A code write saves even when content is invalid.** A proposal is not the
   site, and errors stay visible. The assistant is expected to leave content
   valid. Today its `create_patch` is tried against a copy before it is
   written (`validateSpeculative`) and it is told to call `validate_content`
   after every change, but a CODE write that changes a schema is not checked
   against the content at all: typecheck and lint only. Evaluating code after
   a write (see that section) closes this by reporting each module's errors to
   the assistant.
   - **No "Fix N" in code mode.** Save is the only main button, disabled when
     there is nothing to save or build. The UI for showing errors in code mode
     comes later.
   - **Publish is refused while there are errors**, as today (the publish
     gate), and only a person can publish: the assistant has no publish tool,
     and must not get one.
2. **A save takes every pending change in the proposal, other editors'
   included.** That is what a proposal is.
   - **Code mode is a state of the PROPOSAL, kept by the backend**, not a
     setting of one tab: every Studio in the proposal sees it. Entering it is
     one call to Val's server, which saves the pending changes and records the
     state with the content service.
   - **The save before a code write happens in the server's write path**, not
     in the Studio, so every writer gets it: the assistant in the Studio, and
     later the same code tools over MCP.
   - What the original request's query parameter does with this: it opens the
     proposal and, if code mode is off, turns it on.
3. **Commit and Publish use the commit settings that exist**
   (`studio.commitMessage`).
4. **Commit is refused if the branch is not where Val last left it**, that is,
   someone else pushed to `val/p/<name>`. Expected to be rare.
   - **What the person is offered has to work.** Refreshing alone would lead to
     the same refusal, because the content service's state does not include
     the other push. So, first: the refusal names who pushed and when, links
     to their commit, and says Val will not commit over it.
   - **Built (2026-11-02): Build on their push.** The refusal offers it, for
     Commit and for Publish alike, instead of Try again. Content's
     `POST /proposals/:name/take-push` (valbuild/home's take-push contract)
     stages the files their push changed; where the proposal changed a file
     too, the proposal's version is kept ("Val's wins") and the answer lists
     it; what a proposal cannot hold (outside the project, `node_modules/`,
     symlinks, submodules) is listed as not taken, and the next Commit
     leaves it as the base has it. Their commit becomes what the next Commit
     is made on top of. Val's server saves every pending change first, at the
     proposal's address (`beforeProposalCodeWrite`), code mode or not: their
     push is a developer's code, not the assistant's. The Studio then
     rebuilds the preview (content does not); Commit goes at once, Publish
     waits for the build (merge check `taken-push`, action `build`). If their
     push moved again, the press is refused with a `someone-pushed` of its
     own, and the notice moves to the newer commit. Every other refusal
     offers only what can work: Try again (busy, GitHub down, no answer),
     Sign in, Billing (the plan's 403, which a save gets too),
     Commit/Publish again (nothing left to take), or nothing but their
     commit (too many files, unreadable). The notice is
     `CommitRefusedNotice`; the press is `buildOnTheirPush`, which C7-C10
     drive.

5. **Code mode can be turned off, and turning it off discards nothing.** It
   stops the save before each code write, and the code tools refuse. Code
   already written stays in the proposal; content edits are pending again
   until the next save. Turning it back on saves everything first, so the
   mismatch cannot come back. An assistant in the middle of a turn gets a
   clear refusal from its next code tool, naming who turned code mode off.
6. **The mode is shared; the view is each person's.** The proposal's mode
   (saves before code writes, code tools allowed) is the same for everyone in
   it. Whether a person sees the code mode workspace or the content editor is
   theirs: an editor fixing text can stay in the content editor while someone
   else's assistant changes code, and their edits are saved before each code
   write. Everyone sees the `</>` pressed, and a line in the proposal's menu:
   "Code mode on: turned on by Kari, 10 minutes ago".

### Tests

- Scenarios: entering code mode with pending edits saves them; an edit, then
  a code write, saves the edit first and the write sees it in the text; a code
  write that changes content keeps it through a save and a reload; S10b goes
  green on this route.
- The push behaviour is home's (the `push` job), so its tests are in home;
  the world can model "a save does not queue a push" only once it has the
  content service (see S20 and S21).

## Public API

**The aim is no change to the public API**, and the plan as written has
none that breaks anything. What it does touch:

**Unchanged:** `s.*` and `c.*`; `fetchVal`, `useVal` and the key and route
readers (signatures and results); `ValProvider`'s props, `suspend` included
(see `overlaySource`); `ValModulesClient`; `initValServer`, `initValContent`,
`initValMcp`; `ValApp`; the CLI.

**Additive, optional:**

- Next: an optional `draft` prop on `ValProvider` and a `fetchValDraft` in
  `@valbuild/next/rsc`, mirroring TanStack's, for an app that wants the draft
  at SSR. Without them, Next behaves as today. (Phase 4 added the prop. The
  reader was held back as a public API addition beyond the one the phase was
  given, and then decided: `fetchValDraft` on what `initValRsc` returns, as
  TanStack's `initValContent` has it, with the same type,
  `() => Promise<ValDraft | null>`. Both are `readDraftChanges` in
  `@valbuild/server`'s `draftReads.ts`; TanStack adds the proposal's
  snapshot and the draft's base.)
- `stegaEncode` in `@valbuild/react/stega` takes an optional `version`.

**Kept although they become redundant:** `initValContent`'s `patchStore`,
`sourceFiles` and `http`. With one runtime per process they say what
`initValServer` was already told; they keep working, and if the two disagree
the runtime logs a warning. Deprecating them is a later decision, not part of
this plan.

**Behaviour that changes, with no signature change:**

- Fewer refreshes in draft mode (no safety refresh), and the refresh comes when
  the server has the edit.
- `fetchVal`'s error fallback no longer encodes edit tags for visitors (a bug
  fix).
- MCP reads the same content version as the Studio on a hosted site (a fix).
- A draft `fetchVal` no longer validates and previews the whole site on the way
  (nothing a page used).
- In the Studio: no schema dialog; edits that no longer fit a new schema are
  held, not deleted.

**Not public, versioned with each release:** the `/api/val` routes (a manifest
and a module endpoint are added, `/stat` keeps its old fields for a release)
and the wire to the content service (new fields optional, as above).

**Considered and dropped, because they would have changed the API:**

- Giving TanStack `draft` by default. The provider cannot read the server's
  draft without the app's loader, so it would have needed a new setup step.
  The prop stays explicit, and the templates already pass it.
- A build plugin for Next to emit a registry entry per build (phase 9). Code
  mode runs on the hosted platform, which builds TanStack Start through
  `@valbuild/tanstack-build`, so the entry is emitted there with no change to an
  app. Next keeps HMR in dev.

A phase that finds it needs anything outside this list says so in its PR
before it is merged, and this section is updated.

## Reloading the schema while the Studio runs

The schema a reader uses is an INSTANCE from the bundle: it carries the
author's closures (`validate`, `preview`, `render`), so it cannot come from the
server as data. The version tells the Studio that a module's schema changed
(section 7); something then has to put the new instance in place without
reloading the page, or code mode reloads the Studio after every build and
takes the chat, the unsaved edits and the navigation with it.

### What exists today

- **In dev, HMR swaps the registry.** `<ValModulesClient>` sets
  `window.__VAL_MODULES__` and dispatches `val-modules-updated`;
  `useValModules` hands the new registry to `HostStore.receive`, which
  serializes the new schemas and keeps the new instances.
- **But it merges.** `SchemaStore.receive` does
  `{ ...this.schemas, ...schemas }`, so a module removed from `val.modules`
  stays in the Studio until a reload. According to the inventory, search and
  references are not marked stale on `schema:init` either (to confirm).
- **When hosted, the only answer is a full reload.** `SchemaFreshnessWatch`
  compares the schema this page runs with the server's, and shows a one-way
  dialog that reloads the page.

### What it should be

**One function, whatever brought the new code:**

```ts
// packages/ui/spa/stores/HostStore.ts
type CodeReload =
  | { status: "reloaded"; changed: ModuleFilePath[]; removed: ModuleFilePath[] }
  | { status: "kept"; reason: "does-not-load" | "other-val-version" | "not-the-manifest's"; details: string };

/**
 * Replaces the schema instances in one turn: serialized schemas, instances,
 * and the per-module schema versions the sources compare against. Only the
 * modules whose schema version moved are touched; a module no longer in the
 * registry is removed, not kept.
 */
reloadCode(registry: ValModules, expected: Manifest): Promise<CodeReload>;
```

**Where the new registry comes from:**

- **Dev:** HMR, as today. `val-modules-updated` calls `reloadCode` instead of
  `receive`.
- **A new build, hosted** (a publish with code, or a proposal built in code
  mode): every build emits its `val.modules` registry as an entry of its own,
  `/_val/modules/<build>.js`, an ES module whose default export is the
  registry, importing the build's own chunks. The manifest names it
  (`project.modulesEntry`), and the Studio `import()`s it when `build` moves
  and a module's `schema` moved with it. The build step is
  `@valbuild/tanstack-build`, which is where the platform's builds come from.
  There is no Next plugin, and none is added (see [Public API](#public-api)).
- **Staged code, before any build** (the assistant's `write_files`): the
  registry the tab evaluated itself, see
  [Evaluating code after a write](#evaluating-code-after-a-write). This is
  the common case in code mode.
- **A build whose `@valbuild/*` versions differ from the Studio's own** (an
  upgrade proposal) cannot be swapped in: the Studio's own code is part of
  what changed, and old stores would run against a new core. `reloadCode`
  answers `other-val-version`, and the Studio reloads itself, without asking:
  it waits until no write is in flight (`PatchSync` idle), and the reload
  loses nothing, because where the editor is and the chat session are in the
  URL and every edit is on the server. Until then, the modules whose schema
  moved are `pending` like any other, with "Val was updated in this proposal"
  as the reason. This is rare (once per upgrade), not once per build.

**The dialog goes.** In code mode a schema changes every time the assistant
builds, so a modal that stops the editor and reloads the page cannot be how a
schema change arrives. `SchemaFreshnessWatch`, `StatusStore.reportSchemaOutOfDate`
and the dialog behind them are deleted in phase 9. What the watch knew is
kept, in the places that now own it:

- _A tab can load a new bundle and be answered by the old build for a while_
  (the platform's pointer lags per location): `reloadCode` only adopts a
  registry whose versions equal the manifest's, so a manifest from the old
  build is simply not adopted.
- _During a deploy the old and the new build both answer, and the last answer
  to land is not the newest_: `seq` orders them, and an older answer is dropped
  (section 1).
- _In dev a schema edit reaches the server and this page's HMR in either
  order_: the reads of that module are `pending` until both have arrived,
  which is the schema rule in `layered`, not a timer.

**What a reload does to the stores, for the changed modules only:**

- `SchemaStore` replaces their serialized schemas and removes the modules that
  are gone; `HostStore` replaces the instances.
- Previews, validation, search and references are marked stale for those
  modules, and recompute on demand (marks and demand, as `stores.md` says).
- `layered`'s schema rule now matches, so the reads that were `pending`
  ("another schema") resolve, through the same path as any other change.
- The page in the canvas has the old build's code: its frame reloads. The
  Studio around it does not.

**What must not happen:**

- **A registry that does not load must not take the Studio down.** In code
  mode the assistant can break a `.val.ts`, and the Studio is what it fixes it
  from. `reloadCode` evaluates the new registry before it touches anything; if
  it throws, the Studio keeps the old instances, answers `does-not-load` with
  the error, and the modules whose schema moved stay `pending` with that error
  shown and an action to send it to the assistant. This is the guarantee the
  design tab got by running on the site's build, kept without a second tab.
- **A registry must not be adopted against the wrong manifest.** The versions
  `reloadCode` computes from the registry have to equal the manifest's;
  otherwise (a registry from a build newer or older than the manifest the
  Studio holds) it answers `not-the-manifest's` and waits for the next one.
- **Edits must not be lost because the schema moved.** Today a patch that
  cannot be applied is deleted (`stores.md`), which is right when nothing
  could ever apply it. After a schema change it is wrong: an edit to a field
  that was renamed fails, and deleting it deletes the editor's work. Patches
  that fail right after a code reload are held and shown ("These edits do not
  fit the new schema"), with the choice to discard them or to have the
  assistant move them.

### Tests

- `world.changeCode` drives `reloadCode` in the Studio, through the same
  `val-modules-updated` path in dev and through the manifest's entry for a
  build, so both are covered by every code-change scenario.
- Scenarios: a schema change with unsaved edits (they are kept, and the ones
  that no longer fit are held, not deleted); a new build whose `val.modules`
  throws (the Studio keeps running on the old schema and says why); a module
  removed (it disappears from the Studio); a build with other `@valbuild/*`
  versions (the Studio reloads itself once no write is in flight, and comes
  back where it was with every edit); and the three cases the watch handled
  (a lagging pointer, old and new build answering together, HMR and the
  server in either order), none of which may show anything to the editor.
- A new invariant for every scenario: **no dialog about the schema, ever.**
- Budget: a code change that touches one module re-serializes, re-validates,
  re-previews and re-indexes that module and nothing else.

## Evaluating code after a write

When the assistant's `write_files` stages a `.val.ts` (or `val.modules.ts`, or
anything a `.val.ts` imports), the schema and the content of the modules it
affects are known only by running that code. Something has to evaluate it.

### What happens today

- `stagedModuleSources` (`packages/server/src/stagedModuleSources.ts`) reads a
  staged `.val.ts` WITHOUT running it (`evaluateExpression`, literals only), and
  sends the Source to the content service with the staging. There is no schema
  in that, so home records the new Source with the previous schema's sha
  (`stagedModuleRows`). That is the pair the version model says must not exist,
  and a likely part of the "a new field reverts" bug.
- A build bundles content as literals and does not evaluate it for the content
  service either.
- "Update from the site with code" already evaluates a project in the browser:
  `bundleValModules` (rolldown, from a file map, against the site's vendor
  chunks) in `builder.worker`, imported in a worker by `evaluateTree`, read by
  `readValModules` into `{ schema, written, errors }`. That is the piece to
  reuse.

### What it should be

**After each staging, the tab evaluates `val.modules`, in the background**, the
way the typecheck already runs after each change:

1. **Bundle** `val.modules.ts` and what it imports, from the site's source with
   the proposal's files over it (`bundleValModules`). Routes and components
   are not part of it, so a broken component does not stop it; a broken
   `.val.ts` does, and that is an error the assistant has to see anyway.
2. **Evaluate it in a worker** first (`evaluateTree`), with a deadline. A
   module that throws, or never finishes, costs a worker and not the Studio.
3. **Compare** each module's `schema` and `base` with the previous evaluation.
   Only the modules whose versions moved are affected, however many files the
   write touched, because a change to a shared schema file reaches every
   module that imports it and no other.
4. **Record** the moved versions with the staging: the content service gets
   each changed module's Source AND its schema sha, together. The staging bug
   cannot be written any more. This trusts the tab's report, as update with
   code already does (`design-tab.md`, "What this trusts").
5. **Swap the schema in**: once the worker has shown the bundle loads, the
   Studio imports the same bundle in its own realm and calls
   `reloadCode(registry)`. That is the "staged code" source of a registry in
   [Reloading the schema](#reloading-the-schema-while-the-studio-runs), and it
   means a field the assistant adds can be typed into seconds after the write,
   without waiting for a build.
6. **Tell the assistant**: `write_files` (or a `val_modules_status` beside
   `typecheck_status`) answers with the modules whose schema moved and any
   module that does not evaluate, with its error. A `.val.ts` that throws is
   then the assistant's to fix, not a Studio that silently shows stale fields.

Until the evaluation finishes, the moved modules are `staged:<inputs hash>`
(section 7): their content is `pending`, never read with the old schema.

**Why the Studio's own realm is acceptable** for step 5: in code mode the Studio
runs at the proposal's address, and the proposal's build already runs this
same code on that origin with the editor's session. Evaluating it in the tab
is no more exposure than building it. The worker in step 2 is for robustness
(a loop or a throw), not for isolation.

**Where it does not run:** in an isolate. Evaluating every module's content
grows with the site, which home's rule keeps out of 128 MB
(`docs/plans/upgrades-v2.md` in valbuild/home). A build that the platform
makes (adept) can evaluate too, and should report the same versions, so a
proposal built on the server and one evaluated in the tab agree.

### Cost

Not measured. Update with code gives each tree a 2-minute deadline, which says
nothing about a single `val.modules` bundle. Phase 0 measures it on
`tanstack/full` and valbuild/web: the bundle (rolldown in the browser) and the
evaluation, cold and warm. If it is slow, the bundle is kept between writes
and only rebuilt for what changed, which rolldown's incremental builds may
allow.

### Tests

- A scenario where `world.writeFiles` (the assistant's write, not
  `world.changeCode`) stages a `.val.ts` that adds a field: the Studio gets the
  field from the tab's evaluation, the content service records the Source with
  the NEW schema sha, and an edit to the field is kept.
- A `.val.ts` that throws: the Studio keeps the old schema, the module is
  pending with the error, and the assistant is told.
- A change to a shared schema file: exactly the modules that import it move.

## Appendix: the inventory

One line per place content is read, as of 2026-11-01. "The bundle" is the
app's own built `val.modules`: code, schema and the content as it was built.

**The app**

1. Next `fetchVal`, draft off: the bundle, in-process, no server call.
2. Next `fetchVal`, draft on: a private `ValServer` answers `PUT /sources/~` for the whole tree on every request, memoized per request by React `cache()`.
3. `fetchValKey` / `.jsonValues()` `fetchValRoute`, draft on: one in-process `GET /json` per call, not memoized; draft off, the bundle's `import()`.
4. `fetchValRouteUrl`: `fetchVal` on the whole router module, importing every entry to build one URL.
5. TanStack `fetchVal`, draft off: the bundle under the platform's snapshot (content version + proposal saves), built once per isolate.
6. TanStack `fetchVal`, draft on: as 2, with its own private `ValServer`, memoized per `Request`.
7. TanStack `fetchValDraft`: 6 trimmed to modules with patches, plus `/patches` and `/json` for touched entries, sent as loader data.
8. Client hooks during SSR and hydration (Next always, TanStack without `draft`): an empty store, so the bundle.
9. TanStack hooks with `draft`: seeded from 7 on server and browser; edit tags added the render after.
10. Client hooks without the Val Enable cookie: the bundle, no requests.
11. Client hooks with the overlay in draft mode: `ValExternalStore` fed by the Studio's events, holding only modules the Studio has changes for.
12. After an edit: `router.refresh()` / `router.invalidate()`, throttled to 500 ms, plus a safety refresh every 10 s; each redoes 2 or 6.
13. Client `useValKey` and route hooks outside draft mode: `import()`s in a module-level cache never invalidated.
14. The canvas: as 11, by `postMessage` through `ValCanvasBridge`; design frames get nothing, compare frames only `sourcesSynced`.
15. Demo: the canvas page gets content only by `postMessage` from the in-tab server.

**The Studio**

16. Base content and schema: `window.__VAL_MODULES__`, never `/schema`; TanStack's `__VAL_BASE__` replaces the content, not the schema.
17. The chain: ids from polled `/stat`, ops from `GET /patches`, applied by `SourceStore`.
18. BaseAlignment: another build's base from `PUT /sources/~?apply_patches=false`; content changes, schema stays.
19. `.jsonValues()` entries: `GET /json?apply_patches=false` on read; invalidated only by a rebase.
20. Previews and custom validation: the bundle's instances over the store, cached per module.
21. Schema validation: in a worker, keyed by schema version; "Check everything" asks the server's build.
22. Search and references: an in-process snapshot, staled per module on a patch, not on a schema change.
23. The assistant: content tools read the stores; code tools read `/project-source`, memoized for the hook's life.
24. The design tab: text files only, the proposal's against `/project-source`; its assistant reads the site's stores.
25. Quick preview: the proposal's files over the site's for the browser half; the server half is the last build.
26. Update from the site with code: three trees evaluated in workers; the server trusts what they report.
27. Compare with the site: `/proposal-site-sources` by raw `fetch`, walked with the proposal's schema.
28. History: a read-only system seeded from the live stores, the commit's modules laid over, an LRU of 20.
29. Restore: the old value from `/history/module`, checked against today's schema, written as a patch.
30. Publish: the gate validates from the stores; `/save` re-applies on the server; the managed build uses `/project-source`.

**Val's server**

31. Every `ValOps`: the app's imported modules, evaluated once per instance and memoized; only `/save` moves it.
32. Several instances per process, each with its own memo.
33. `/stat`: fs long-polls the log and file watches; http asks the content service each call; memory long-polls a signal.
34. `PUT /sources/~`: memo + the whole chain, fetched and applied each call; previews always; no cache.
35. `GET /patches`: the log, the content service or memory; no cache on Val's side.
36. `PUT /patches`: appended (fs ignores the parent) or posted with the parent (http); no validation.
37. `/files`: the patch directory or disk (fs), the content service (http); `max-age=0`.
38. `/save`: rewrites `.val.ts` text, no schema validation; records content + this build's schema.
39. History: module versions stored at each commit, immutable.

**Tooling**

40. `val validate`, `--fix`, `list-unused-files`: disk, evaluated in `node:vm`, no patches.
41. The language server: the same loader over unsaved buffers; dropped on any change.
42. The VS Code extension: runs the project's own language server.
43. MCP: the app's modules, patches applied and the index rebuilt every call; no content version or snapshot.
44. `val publish`: validates the checkout; with `--artifacts`, not what ships.
45. `val debug`: the local checkout's schema against the deployed commit's patches.

**The platform (valbuild/home)**

46. A site: the build's bundle plus the content version, handed in as env; the isolate keyed on both.
47. A proposal: the base build (or its own) plus the base's content version plus its overlay.
48. `/project-source`: KV `source:<project>`, which can be ahead of the live build.
49. Staging a `.val.ts`: new Source with the previous schema's sha.
50. Commits: content plus the schema of whichever build saved.
51. Proposal builds: the site's current source with the proposal's files over it.
