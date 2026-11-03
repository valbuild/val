# Scenarios

Val's real server, the Studio's real stores and a page's real readers, run
together in one jest process, with the network and the framework's request
context in the test's hands. Every scenario is checked against the same
invariants, so an edge case is a script of actions rather than a new set of
assertions. The plan this belongs to is
[`docs/plans/one-content-model.md`](../docs/plans/one-content-model.md)
(phase 0, the versions in the frames since phase 1, the engine's counted
work since phase 2, the readers on sources since phase 3, the page
converging on what the server confirmed since phase 4, the Studio
reading through the same engine at versions it computes since phase 5, and
the manifest's "since `seq` N" since phase 7).

```bash
pnpm test scenarios          # from the repo root
pnpm --filter @valbuild/scenarios typecheck
```

## The rule

**Every action the world takes is a call to the function the product calls
for it** (`.agent/rules.md`, "A test drives the product's code"). Where that
function was buried in a component or a hook, it was extracted, the product
calls the extracted one, and so does the world. A scenario that went through a
test-only path would prove that path works and nothing else.

What the world stands in for, and nothing more:

| Edge                           | Stand-in                                                                                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The network                    | `world/network.ts`: delivers every request to the app's real route handler, logs it, can hold it                                                             |
| TanStack Start's request       | `world/tanstackStart.ts`: the request a page read is serving, its headers (with `Host`) and cookies                                                          |
| The Studio's validation worker | `world/noWorkerBridge.ts`: never called, because every Studio validates in-process through `createValSystem`'s `schemaValidation` seam; it throws if reached |

## A scenario

```ts
import { initVal } from "@valbuild/core";
import { createWorld } from "./world/createWorld";

// Every scenario file starts with these two (jest needs them literally here).
jest.mock(
  "@tanstack/react-start/server",
  () => jest.requireActual("./world/tanstackStart"),
  { virtual: true },
);
jest.mock("../../packages/ui/spa/validation/schemaValidationBridge", () =>
  jest.requireActual("./world/noWorkerBridge"),
);

const { s, c, config } = initVal({});
const homeVal = c.define(
  "/content/home.val.ts",
  s.object({ title: s.string() }),
  { title: "Hello" },
);

test("an edit reaches the page", async () => {
  const world = await createWorld({
    config,
    modules: [homeVal],
    server: "fs", // or "memory"
  });
  const studio = await world.studio("editor");
  const page = world.page("/", { draftMode: true });
  studio.reads("field", homeVal, ["title"]);
  page.reads("loader", async (val) => (await val.fetchVal(homeVal)).title);

  await studio.edit(homeVal, ["title"], "Hello world");
  await world.settle();
  await world.observe();

  world.expectInvariants();
  await world.dispose(); // in an afterEach, so a failing test cleans up too
});
```

`world.observe()` asks every surface for what it shows and records a frame.
`world.expectInvariants()` checks the frames, and a failure names the rule,
the surface and the frames:

```
✕ converges: the surfaces disagree at the end
    2  field        "Hello world"
    2  loader       "Hello"
```

## What each part is

| Part              | The product code it runs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server            | `initValServer` from `@valbuild/tanstack/server`: the route handler an app mounts, in memory, fs or http mode. http talks to the mock content host (`e2e/mock-content-host`) in the test's process, over real HTTP (`world/contentHost.ts`), with a signed session cookie on every request                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Studio            | `createValSystem`; modules in through `loadValModules`; a `/stat` long poll through `requestStat`, `statStateAfterAnswer` and `statWait`, taken in with `statSnapshotOf`; in http mode the content service's socket too, read with `parseSocketMessage` and `statStateAfterSocketMessage`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| An edit           | `stringFieldPatch` and `patchStore.createPatch`, what a string field calls                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Page, server half | `initValContent`'s `fetchValStega`, with the same patch store as the API, as an app passes it; what it read comes from the read behind it (`readsOfFetchVal`), which the public function only drops                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| A page load       | `world.loadPage`: `fetchValDraft` (the server render, with the `draft` prop; `draftProp: false` for a page without it), `createDraftStore` (the server's and the browser's store, from `@valbuild/react/stega`), the overlay's Studio from the page's client modules and `window.__VAL_BASE__`, `startOverlayRelay` with what the page reports holding (`draftHolds`) → `applyValEvent`, and the provider's refresh loop (`startRefreshLoop`, told each `confirmed`); read with the hooks' own env (`pageReadEnv`) and reads (`resolveVal`, `resolveModuleEntry`, `moduleRouteRead`) at every step of the provider's state -- server render, hydration, overlay mounted (`suspend` on, if asked), draft mode known, synced, relayed -- recording a frame, or a suspension for a read that waits |
| Two builds        | `world.deployCode` returns the previous and the new handler; `network.routeBy` picks one per request (a rollout); the log says which answered (`Exchange.to`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Versions          | Each frame carries, per module it read, the source that answered, its version (`ModuleVersion`) and the schema of the code that read it. A loader's from what the reader says it read (`readsOfFetchVal`, `readsOfFetchValDraft`: `resolveVal`'s reads); a Studio field's from the Studio itself (`SourceStore.versionOf`, since phase 5) and a relayed hook's from the read the relay sent (`read.version`); a bundle's from the module, with the product's own `schemaVersionOf` / `baseVersionOf`. `world.manifest()` is `GET /manifest`                                                                                                                                                                                                                                                     |

## The scenarios

| File                                 | What it asserts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Today                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `smoke.scenario.test.ts`             | An edit in the Studio reaches a draft page's `fetchVal`; with draft mode off the page keeps the published content                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | passes, memory, fs and http                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `twoEditors.scenario.test.ts`        | An edit by one editor reaches the other editor's field through `/stat` and a fetch of the patch                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | passes, memory, fs and http                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `addedField.scenario.test.ts`        | A field added to a schema can be typed into and kept, (a) when the server and the Studio both have the new code, (b) when the Studio gets it before the server                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | (a) passes; (b) **fails, marked `test.failing`**: the edit is discarded. Code mode's save before a code write does not reach it (HMR is no write through the server); its hosted form passes as C5 in `codeMode`. See the test's comment                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `overlayAfterBuild.scenario.test.ts` | After a code change and a build, a draft page loaded with the overlay never shows the new content, then the old, then the new                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Same build: passes, with and without a pending edit. S26, the overlay's `/stat` answered by the previous build, **passes in memory and fs** since phase 7's first part: there the chain is the store's, so the previous build names the newest build's base as the one its chain belongs on (`ValOps.chainBaseSha`), the Studio already holds it, and nothing is fetched or relayed. **And on http** since valbuild/home's live build (phase 7): every build reports its base (`sources_sha`), and `/stat` asks for the chain relative to the live build (`relative_to=live`); a previous build is answered at the live one, with its base, and names that (`OrderedPatchesMetadata.chainBase`). The world names each http build (`publishBuild`), reports it live as the platform does, and opens a page only once that report has landed. The test now also says the page ends on the new title, which "converges" cannot see with one surface. **S27 is skipped**, with a running test pinning why: the browser runs the previous build's client code, so hydration reads the old bundle -- before the overlay is there to say anything (home's loader, after phase 9) |
| `sync.scenario.test.ts`              | S05 a refresh that lands before the write: nothing is re-read while the write is held, once after it lands, and never on the clock; S07 a discard in the middle of the chain reaches every reader, and none goes back (the title's value returns at a chain no surface had shown); S08 the write after a discard; S09 a publish while a draft page is open; S28 a draft discarded before the page's overlay connects: the page reports what it was rendered with a draft of (`draftHolds`), the Studio sends those modules, and the hook and the loader end on the published title -- also for an edit inside a `.jsonValues()` entry the overlay's Studio has not read                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | S05, S07, S08, S09, S28 pass, memory, fs and http. S28's `.jsonValues()` form failed until phase 5 (a held module with entries the Studio had not read was left out of the catch-up; the Studio's view now knows which entries differ from the page's bundle, `SourceStore.entriesToRelay`). S05 failed until phase 4 (the edit reached the page's store, which re-ran the loaders against a server without the write, and only the 10 s safety refresh caught up); the page now refreshes on the Studio's `confirmed`, and the safety refresh is deleted                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `contentShapes.scenario.test.ts`     | S17 an edit inside an unloaded `.jsonValues()` entry; S18 an upload's `patch_id` reaches the page where the file lands (a video poster); S19 a gallery-backed field whose gallery changes, and the field's module keeps its version (only the gallery's chain moves)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | S18, S19 pass, memory, fs and http. S17 passes too, since F1 and F2 were fixed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `readers.scenario.test.ts`           | S22 the loader, the hook and the Studio field agree: at the same version the same value, over every frame, and at the end all three at the server's version; S23 draft at SSR with no flash of published content; S24 `suspend` is three waits and nothing else suspends: without `suspend` no read waits (with and without the `draft` prop); with it, the hooks wait for draft mode and then for the Studio before showing the draft; with it and the `draft` prop a route only in a pending patch is found on every render                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | S22, S23 pass, memory, fs and http (S22 without a timer since phase 4), and so do S24's "nothing suspends", its route with the `draft` prop, and S24b, the hooks waiting for the Studio (fixed in phase 4: the relay said `sources-synced` before the module with the pending edit, because the chain's records were not in when the base aligned; it now waits until the store is in step, `onceInStep`). **One S24 finding is `test.failing`**: wait 3, without the `draft` prop the gate is off on the render that decides, so a route only in a patch is not found at the server render and hydration (`architecture/quirks.md`). Next's `ValProvider` takes the `draft` prop since phase 4; the world drives a TanStack page, so Next's is pinned by `packages/next/src/ValNextProvider.draft.test.tsx`                                                                                                                                                                                                                                                                                                                                                              |
| `codeChanges.scenario.test.ts`       | S11 a schema change while the page shows an edit: nothing read with the old schema, and only that module's version moves; S11 a new build is counted (`seq` moves); S12 a module whose code throws is reported; S13 a removed module disappears; S14 edits that no longer fit a new schema are kept; S16 no schema dialog after a deploy the Studio has not got                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | S11, S12 and S13 pass (S12: a module whose code throws is kept as it was, and the editor is told which; S13: an intake replaces, so a removed module goes). "A new build is counted" passes on http too: there `seq` is the content service's `headVersion`, which valbuild/home now moves once per deployment going live (`patches.countDeploymentLive`); the world reports each new build live to the mock content host, as the platform would, and the mock does the same (`countDeploymentLive` in `e2e/mock-content-host/server.ts`). It was `test.failing` on http until home did. **S14, S16 are skipped**, each with a running test pinning today's behaviour: an edit that no longer applies is deleted, on the server too; `SchemaFreshnessWatch` reports the schema out of date (by design today; the plan removes the dialog)                                                                                                                                                                                                                                                                                                                                 |
| `budgets.scenario.test.ts`           | B01 a keystroke applies its patch once, even after the echo; B02 another editor's keystroke costs one patch, not the module; B04 reading hashes no version (a loader, `/stat`, the manifest); B05 a keystroke costs one link of the chain; B06 a keystroke copies only along its path (the server's engine: the root per apply for a title, the root, the list and the item for one item of 200); B07 a read resolves once per wait and encodes once (a draft `fetchVal`: two resolves, one encode; a visitor's: one and one); B08 a draft page re-reads its server once per confirmed edit (two edits, two refreshes; another editor's, one more; none for connecting when the page was rendered from the draft, one when it was rendered without it), and none in a minute of quiet; B09 a Studio keeps the last two versions of a module after forty keystrokes (the heap guard), and discarding the newest edit applies nothing; B10 a manifest "since `seq` N" from the one a client holds is a 304 while nothing moved and names the one edited module after an edit, hashing nothing (phase 7). Since phase 5 B01, B02, B04, B05 and B06 count the Studio too: one engine apply per keystroke, its path copied, no module cloned, one version hashed, none on a read | pass, memory, fs and http, counted with the stores' `RecordingActivity` (`studio.expectWork`: a Studio's own `source:apply-patch`, `engine:clone-bytes` and `version:hash`, summed where they are amounts), Val's server's version hashes (`world.expectWork`, `version:hash`, less what the world hashes to observe and what the Studios say they hashed), the server's engine work (`world.expectWork`, `engine:apply-patch` and `engine:clone-bytes`, from `engineWork()`, less the Studios') and the readers' (`read:resolve`, `read:encode`, from `readWork()`), and a page's refreshes (`page.refreshes`, `startRefreshLoop`'s own count)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `hosted.scenario.test.ts`            | S20 a content version newer than the bundle, with an unedited module; S21 a proposal's address: its saves over the base content. Every reader: the overlay's Studio, a `/val` Studio (no `__VAL_BASE__`), a draft and a visitor `fetchVal`, and the hooks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | pass, http (the only mode with hosted layers)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `statOrder.scenario.test.ts`         | S06 a `/stat` answer computed before an edit and delivered after it (`network.hold` with `at: "answer"`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | passes, http: the only mode where it can happen. In fs and memory a Studio's one `/stat` is a long poll, answered when something changes, so there is no early answer to deliver late                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `proposals.scenario.test.ts`         | P1 an edit in a proposal is not on the site; P2 a save makes it the proposal's, and leaves the site; P3 two editors in one proposal; P4 a staged `.val.ts` change, through the assistant's `write_files`, is the proposal's Source; P5 publish in a proposal merges it into the site                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | pass, http (proposals are hosted only)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `projectSource.scenario.test.ts`     | The code tools read the site's live source by version: asked with its `ETag` on every call, 304 while nothing moved, and a publish in between is seen                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | pass, http (phase 7, valbuild/home `/v1/project-source` `ETag`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `codeMode.scenario.test.ts`          | C1 entering code mode saves every pending change; C2 a code write (`write_files`) saves the content changes made since, first; C3 with code mode off a code write is refused and nothing is written; C4 turning code mode off keeps the code and the pending edits, and the code tools refuse; C5 a field the assistant added is filled in and kept (S10b in code mode); C6 Commit, and the commit Publish makes, are refused when someone else pushed to the branch, naming who and linking their commit; C7 build on their push (`buildOnTheirPush`): their files come in, a file both changed keeps the proposal's (with the pending edit saved first), Commit goes on top of their commit, Publish waits for the build (`buildProposal`) and then merges their file with the proposal's content; C8 their push moved again before the press: the newer push is named, nothing comes in, and building on it brings in both (Publish's refusal read with `publishCommitRefusalOf`); C9 with nothing of theirs left to take in, the press says so and Commit goes; C10 a file the proposal holds only because an earlier push of theirs was taken in is taken again from their next push, not kept                                                                         | pass, http (proposals are hosted only). S10b's local-development form in `addedField` still fails: see the note there                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `matrix.*.scenario.test.ts`          | The content-shape matrix: shape × operation × surface, in memory, fs and http. See below                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | every surface that works passes; every one that does not is `test.failing`, named after its cause (`(fails today: F1)`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

### The content-shape matrix

"Do `.jsonValues()`, image, file and video libraries and plain media work as
expected in every case?" is a grid, so it is tested as one:
`matrix.jsonValues`, `matrix.libraries` and `matrix.media` (the harness is
`src/matrix/harness.ts`). One CELL is one operation on one shape, run once in
a world of its own; each SURFACE it names is then its own test, so a red cell
says which reader is wrong. Every cell also checks "never goes back" and that
no Studio showed an error. A surface that is wrong today is marked
`test.failing` with its reason, and its test name ends `(fails today: <code>)`,
so it turns red the day it is fixed and the mark has to come off.

Every edit goes through the function the product's UI calls (test rule 3);
these were extracted for it, and the components call them:

| What the editor does                             | Function                                                                                                                                    |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| New entry / delete entry (record popovers)       | `recordAddPatch`, `recordRemovePatch` (`components/recordPatches.ts`)                                                                       |
| Rename a key                                     | `renameRecordEntry` (`components/useRenameRecordEntry.ts`)                                                                                  |
| Upload into, alt text in, delete from a library  | `galleryRef`, `galleryUploadPatch`, `galleryAltPatch`, `galleryRemovePatch` (`fields/galleryPatches.ts`)                                    |
| Pick from a library                              | `mediaPickPatch` (`fields/mediaPickPatch.ts`)                                                                                               |
| Upload into a plain image or file field          | `createFilePatch` (`fields/createFilePatch.ts`)                                                                                             |
| A video, a library video, a poster               | `createVideoPatch`, `createVideosetEntryPatch`, `createPosterPatch` (already plain functions)                                               |
| What `useVal` / `useValKey` / `useValRoute` read | `pageReadEnv`, then `resolveVal`, `resolveModuleEntry`, `moduleRouteRead` (`@valbuild/react/stega`, `tanstack/src/client/initValClient.ts`) |

The browser's own part -- `FileReader`, decoding an image, converting a
video -- is the edge: the world hands over the data URL, its SHA-256 and the
metadata that part would have read.

The surfaces: `studio` is the editor's `SourceStore` at the field;
`fetchVal*` is the page's server, read fresh once the world has settled;
`useVal*` is the page's client half through the overlay; `GET … url` fetches
the url that reader gave and compares the bytes; `file on disk` and `source
text` are fs mode after a publish. Memory mode refuses to publish a local
file, so the media publish cells run in fs only. `ok` passes, a code is
`test.failing` for that cause, `—` is not a surface of that cell.

#### jsonValues

| Operation                                       | studio | fetchVal | fetchValKey | fetchValRoute | useVal | useValKey | useValRoute | fetchVal keys | useVal keys | entry file on disk | studio, opened after | never goes back, no errors |
| ----------------------------------------------- | ------ | -------- | ----------- | ------------- | ------ | --------- | ----------- | ------------- | ----------- | ------------------ | -------------------- | -------------------------- |
| edit an entry (/blog/a)                         | ok     | ok       | ok          | ok            | ok     | ok        | ok          | —             | —           | —                  | —                    | ok                         |
| add an entry (/blog/c)                          | ok     | ok       | ok          | ok            | ok     | ok        | ok          | ok            | ok          | —                  | —                    | ok                         |
| rename a key (/blog/z)                          | ok     | ok       | ok          | ok            | ok     | ok        | ok          | ok            | ok          | —                  | —                    | ok                         |
| delete an entry (/blog/b)                       | ok     | ok       | ok          | ok            | ok     | ok        | ok          | ok            | ok          | —                  | —                    | ok                         |
| discard an edit (/blog/a)                       | ok     | ok       | ok          | ok            | ok     | ok        | ok          | —             | —           | —                  | —                    | ok                         |
| publish an edit (/blog/a)                       | ok     | ok       | ok          | ok            | ok     | ok        | ok          | —             | —           | ok                 | —                    | ok                         |
| another editor's edit, via /stat (/blog/a)      | ok     | ok       | ok          | ok            | ok     | ok        | ok          | —             | —           | —                  | —                    | ok                         |
| a code change to the item schema (/blog/a)      | ok     | ok       | ok          | ok            | ok     | ok        | ok          | —             | —           | —                  | —                    | ok                         |
| an edit to an entry nobody has loaded (/blog/a) | —      | ok       | ok          | ok            | ok     | ok        | ok          | —             | —           | —                  | ok                   | ok                         |

#### imagedir

| Operation                              | studio field | fetchVal field | useVal field | studio entry new | fetchVal entry new | fetchVal library keys | GET fetchVal field url | GET useVal field url | studio entry A | fetchVal entry A | studio entry B | fetchVal entry B | file on disk | source text names the file | never goes back, no errors |
| -------------------------------------- | ------------ | -------------- | ------------ | ---------------- | ------------------ | --------------------- | ---------------------- | -------------------- | -------------- | ---------------- | -------------- | ---------------- | ------------ | -------------------------- | -------------------------- |
| upload and pick                        | ok           | ok             | ok           | ok               | ok                 | ok                    | ok                     | ok                   | —              | —                | —              | —                | —            | —                          | ok                         |
| edit an entry's alt text               | ok           | ok             | ok           | —                | —                  | —                     | —                      | —                    | ok             | ok               | —              | —                | —            | —                          | ok                         |
| pick an entry                          | ok           | ok             | ok           | —                | —                  | —                     | —                      | —                    | —              | —                | —              | —                | —            | —                          | ok                         |
| delete an unused entry                 | —            | —              | —            | —                | —                  | ok                    | —                      | —                    | —              | —                | ok             | ok               | —            | —                          | ok                         |
| discard an upload                      | ok           | ok             | ok           | —                | —                  | ok                    | —                      | —                    | —              | —                | —              | —                | —            | —                          | ok                         |
| another editor's upload, via /stat     | ok           | ok             | ok           | —                | —                  | ok                    | —                      | —                    | —              | —                | —              | —                | —            | —                          | ok                         |
| a code change to the library's options | ok           | ok             | ok           | —                | —                  | —                     | —                      | —                    | —              | —                | —              | —                | —            | —                          | ok                         |
| publish an upload                      | ok (fs)      | ok (fs)        | ok (fs)      | —                | —                  | ok (fs)               | —                      | —                    | —              | —                | —              | —                | ok (fs)      | ok (fs)                    | ok (fs)                    |

#### filedir

| Operation                              | studio field | fetchVal field | useVal field | studio entry new | fetchVal entry new | fetchVal library keys | GET fetchVal field url | GET useVal field url | studio entry B | fetchVal entry B | file on disk | source text names the file | never goes back, no errors |
| -------------------------------------- | ------------ | -------------- | ------------ | ---------------- | ------------------ | --------------------- | ---------------------- | -------------------- | -------------- | ---------------- | ------------ | -------------------------- | -------------------------- |
| upload and pick                        | ok           | ok             | ok           | ok               | ok                 | ok                    | ok                     | ok                   | —              | —                | —            | —                          | ok                         |
| pick an entry                          | ok           | ok             | ok           | —                | —                  | —                     | —                      | —                    | —              | —                | —            | —                          | ok                         |
| delete an unused entry                 | —            | —              | —            | —                | —                  | ok                    | —                      | —                    | ok             | ok               | —            | —                          | ok                         |
| discard an upload                      | ok           | ok             | ok           | —                | —                  | ok                    | —                      | —                    | —              | —                | —            | —                          | ok                         |
| another editor's upload, via /stat     | ok           | ok             | ok           | —                | —                  | ok                    | —                      | —                    | —              | —                | —            | —                          | ok                         |
| a code change to the library's options | ok           | ok             | ok           | —                | —                  | —                     | —                      | —                    | —              | —                | —            | —                          | ok                         |
| publish an upload                      | ok (fs)      | ok (fs)        | ok (fs)      | —                | —                  | ok (fs)               | —                      | —                    | —              | —                | ok (fs)      | ok (fs)                    | ok (fs)                    |

#### plain s.image()

| Operation                                            | studio field | fetchVal field | useVal field | GET fetchVal field url | GET useVal field url | file on disk | never goes back, no errors |
| ---------------------------------------------------- | ------------ | -------------- | ------------ | ---------------------- | -------------------- | ------------ | -------------------------- |
| upload                                               | ok           | ok             | ok           | ok                     | ok                   | —            | ok                         |
| discard an upload                                    | ok           | ok             | ok           | —                      | —                    | —            | ok                         |
| another editor's upload, via /stat                   | ok           | ok             | ok           | ok                     | ok                   | —            | ok                         |
| a code change to the field's schema, after an upload | ok           | ok             | ok           | ok                     | ok                   | —            | ok                         |
| publish an upload                                    | ok (fs)      | ok (fs)        | ok (fs)      | —                      | ok (fs)              | ok (fs)      | ok (fs)                    |

#### plain s.file()

| Operation                                            | studio field | fetchVal field | useVal field | GET fetchVal field url | GET useVal field url | file on disk | never goes back, no errors |
| ---------------------------------------------------- | ------------ | -------------- | ------------ | ---------------------- | -------------------- | ------------ | -------------------------- |
| upload                                               | ok           | ok             | ok           | ok                     | ok                   | —            | ok                         |
| discard an upload                                    | ok           | ok             | ok           | —                      | —                    | —            | ok                         |
| another editor's upload, via /stat                   | ok           | ok             | ok           | ok                     | ok                   | —            | ok                         |
| a code change to the field's schema, after an upload | ok           | ok             | ok           | ok                     | ok                   | —            | ok                         |
| publish an upload                                    | ok (fs)      | ok (fs)        | ok (fs)      | —                      | ok (fs)              | ok (fs)      | ok (fs)                    |

#### plain s.video()

| Operation                                            | studio field | fetchVal field | useVal field | GET fetchVal field url | GET useVal field url | file on disk | never goes back, no errors |
| ---------------------------------------------------- | ------------ | -------------- | ------------ | ---------------------- | -------------------- | ------------ | -------------------------- |
| upload                                               | ok           | ok             | ok           | ok                     | ok                   | —            | ok                         |
| discard an upload                                    | ok           | ok             | ok           | —                      | —                    | —            | ok                         |
| another editor's upload, via /stat                   | ok           | ok             | ok           | ok                     | ok                   | —            | ok                         |
| a code change to the field's schema, after an upload | ok           | ok             | ok           | ok                     | ok                   | —            | ok                         |
| publish an upload                                    | ok (fs)      | ok (fs)        | ok (fs)      | —                      | ok (fs)              | ok (fs)      | ok (fs)                    |

#### videodir

| Operation                                         | studio field | fetchVal field | useVal field | GET fetchVal field url | GET useVal field url | fetchVal library keys | file on disk | never goes back, no errors |
| ------------------------------------------------- | ------------ | -------------- | ------------ | ---------------------- | -------------------- | --------------------- | ------------ | -------------------------- |
| the field's overrides over the library's defaults | ok           | ok             | ok           | —                      | —                    | —                     | —            | ok                         |
| upload and pick                                   | ok           | ok             | ok           | ok                     | ok                   | ok                    | —            | ok                         |
| pick an entry                                     | ok           | ok             | ok           | —                      | —                    | —                     | —            | ok                         |
| a new default poster in the library               | ok           | ok             | ok           | —                      | —                    | —                     | —            | ok                         |
| discard an upload                                 | ok           | ok             | ok           | —                      | —                    | ok                    | —            | ok                         |
| another editor's upload, via /stat                | ok           | ok             | ok           | ok                     | ok                   | ok                    | —            | ok                         |
| a code change to the library's options            | ok           | ok             | ok           | —                      | —                    | —                     | —            | ok                         |
| publish an upload                                 | ok (fs)      | ok (fs)        | ok (fs)      | —                      | —                    | ok (fs)               | ok (fs)      | ok (fs)                    |

#### The causes

- **R1, fixed.** In memory mode, after a publish the page's readers kept the
  pre-publish content: `initValContent` built its own server instance, and
  only the API's instance that handled `/save` adopted the publish. Every Val
  server in a process now shares one data layer per project
  (`sharedValOps`, used by `nodePlatform.createOps` and by MCP), so
  `fetchValKey` and `fetchValRoute` show the publish.
- **R2, fixed.** In memory mode, after a publish a whole-record `fetchVal`
  filled the published entry from the page's bundle, which still held the
  content from before the publish, while `fetchValKey` and `fetchValRoute`
  read the entry the server adopted. F1's fix read from the server only the
  entries a PENDING patch touches, and after a publish there is none. An
  edit inside an entry does not change the module's source (the content is
  in the `*.val.json`, the source holds a marker), so nothing told a reader
  the bundle's copy was old. Now `adoptCommittedSources` marks each entry the
  publish wrote with the `patch_id` of the patch that last wrote it
  (`markPublishedJsonEntries`): the source moves, the SHAs move with it, and
  `withDraftJsonEntries` (both bindings) reads every marker that carries a
  `patch_id` from the server (`Internal.isJsonFromServer`), as it already did
  for an entry a pending patch added. The matrix's R3 cells passed with the
  same change: the editor's Studio already holds the entry, and its base now
  agrees with the server's, so it is not dropped as stale.
- **R3, fixed.** In memory mode, after a publish the overlay relayed the
  published module with its entries as placeholders (no pending patch named
  them, so the relay loaded none), and the page filled them from its bundle,
  which still held the content from before the publish. The matrix cells
  passed with R2's fix, because the editor's Studio already held the entry;
  a page opened AFTER the publish, whose Studio never had it, still showed
  the bundle's (`jsonValues on memory, a page opened after a publish`, in
  `matrix.jsonValues.scenario.test.ts`). Two places: the TanStack server
  render's draft (`initFetchValDraft`) left out a module no patch touches,
  and now keeps one holding an entry marked by a publish; and the relay
  (`emitModuleSource`) now loads every marked entry, and holds the module
  back until they are read -- handed over as markers first, they replaced
  the server render's entry with the bundle's, then put it back.
- **F1, fixed.** A draft `fetchVal` of a WHOLE `.jsonValues()` record filled
  its entries from the bundle's imports, so every operation that changed an
  entry's content showed the published entry there. In the draft tree an
  edited entry is still a marker; `fetchVal` now reads the entries a pending
  patch touches from the server (`draftJsonValuesRecord`, in both bindings;
  since phase 3 `serverDraftSource` in `@valbuild/server`, for both), as
  `fetchValKey` reads one, and the rest from the bundle.
- **F2, fixed.** A Studio that had not loaded an entry kept the patch it
  could not apply, and never applied it once the entry loaded. The overlay's
  Studio then relayed the published entry to every hook, and the editor's own
  field, opened after, showed "Page A" while the server had "Edited A".
  `SourceStore` now asks for the entry such a patch waits for, and applies
  the chain again when it arrives (`receiveJsonEntry`). Two things it
  uncovered went with it: the relay asks for the entry a rename moves FROM,
  and a patch that VANISHES from the server has its entry read again, since
  a publish that only changes an entry moves no sha and reads like a discard
  (`forgetEntriesOf`). In memory mode the publish cell's hooks now show the
  edit while it is pending and the page's bundle after it, which "never goes
  back" catches: that is R3.
- **L1, fixed.** The server render of a field that picked a library entry
  uploaded in a pending patch gave the PUBLISHED url (no `patch_id`), and
  GET of it answered 500 (image, file and video alike); the hook's url was
  the draft one. Val's server stamps `patch_id` on the library entry, where
  the file op is, and `fillFromGallery` -- the one merge of a field with its
  library entry, for all three -- did not carry it to the field. It does now,
  unless the field has its own.
- **F3 and P1 were the world, not the product.** They were gone once the
  world modelled what a dev server does after a publish: the rewritten files
  are evaluated again (Val's own `loadValModules`, what `val validate` runs)
  and the app's server, the readers, the Studio and the page get the new
  modules (`devReload` in `createWorld.ts`), and once a published file's url
  was answered by the app's static files, as the framework serves `public/`
  (`withStaticFiles`).

#### Not covered, and why

- **Renaming a media file** (`useRenameMediaFile`): it reads the bytes back
  with `fetch` and `FileReader` inside the hook; it needs extracting first.
- **Captions** on a video, and an HLS stream: the conversion is the
  browser's, and the poster cells already cover a library default that a
  field partly overrides.
- **Remote media** (`.remote()`): needs the project's remote-file settings
  and a bucket from the content host. The world has an http mode now; the
  mock answers `/settings`, but the remote cells are not written yet.

### Catalogue ids not built, and why

- **S15** a build with other `@valbuild/*` versions: one jest process runs
  one Val.
- **S25** a failed draft read never gives a visitor edit tags: fixed, and
  pinned by a unit test rather than a scenario
  (`initValContent.wholeRecord.test.ts`, "fetchVal for a visitor whose read
  throws"). The error fallback of `fetchValStega` called `stegaEncode`
  without `disabled`, in both bindings. For a visitor the only throw that
  reaches it is a `.jsonValues()` entry import that rejects; on TanStack a
  proposal snapshot then carried the tagged strings, which is what the test
  drives. Next.js has no snapshot, so its fallback had no string to tag.
- **B03** a draft read in a 128 MB isolate: a benchmark in `workerd`, not a
  jest scenario.

## http mode: how faithful it is

`createWorld({ server: "http" })` runs Val's server in http mode, the mode a
deployed app runs, against `e2e/mock-content-host` -- the stand-in for
valbuild/home that `homeWireContract.test.ts` and the `chromium-http` specs
already hold to home's wire contract -- imported into the test's process
(`world/contentHost.ts`; the mock skips its own `listen` under
`MOCK_CONTENT_NO_LISTEN=1` and exports its `server`).

What is real: `ValOpsHttp` and every call it makes, over real HTTP with the
global `fetch`; the API and the page's readers given ONE `http` options
object (credentials, `valContentUrl`, `gitCommit`, the content version and
the proposal), as the bindings ask; a signed `val_session` cookie on the
Studio's, the upload's and the page's requests (`encodeJwt`, as
`e2e/http/httpMode.ts` mints one); direct uploads, which go from the
"browser" straight to the content host; the socket. The project's files are
written where the mock reads the repository (`MOCK_CONTENT_REPO_ROOT`), so a
publish patches real text.

What is not:

- **The mock is not home, and its proposals least of all.** Proposals
  are off until a world turns them on (`/__test__/proposals-enabled`), as
  in home, where every proposals route answers 404 until they are: a site
  Studio that finds them on does things differently (a restore opens a
  proposal). It keeps a chain per branch, opens proposals, saves and stages into them as commits
  on their branch, keeps the saved state the platform serves an address
  from (`/__test__/proposals/:name/overlay`, what `home`'s overlay step
  writes, re-read by `world.proposal.redeploy()`), records the Source a
  staged module file declares (valbuild/home#369) and merges. What it does
  NOT do:
  - **builds**: a staging is recorded and never built, so its
    `buildRequired` stays true until `world.proposal.build` hands in a
    build of exactly those inputs (`POST /build` with a `publishId`, which
    it records as served), and the address only serves staged code
    through the Source it declares (`world.proposal.redeploy` hands the
    server the overlay; the bundle is the test's);
  - **the render check** after a save, and every job (`setup`, `overlay`,
    `build`): their effects are applied at once, or not at all;
  - **git**: there is no repository. Commit and the commit Publish makes
    first (the code-mode contract) are recorded as `git.committed`, and a
    push by somebody else is the control plane's
    (`/__test__/proposals/:name/push`, with the files it changes), so
    `someone-pushed` is modeled, and so is taking it in (`take-push`:
    their files staged, the proposal's kept where both changed one,
    `not-project-source` paths not taken, `nothing-to-take`, a push that
    moved again, `already`, `too-many-files`, and the `taken-push` merge
    check, the only one the mock enforces at the press);
    `committing`, `repository-refused`, `github-unavailable`,
    `no-git-root`, `unreadable`, rewritten history, merge commits, binary
    files and plan refusals are not. No lockfile;
  - **the merge as a publish job**: a press of Publish in a proposal is
    sealed at once (`{ request: live, job: null }`) -- no tab, no
    merge-prepare, no build, no verify -- and moves none of the site's
    pending changes (`move-inputs` answers 404, so the press goes as sent);
  - **Update from the site**, `merge-inputs`, `merge-trees`, `restore-code`,
    `patch-file`, `build-target`, the typecheck and quick previews: 404,
    "not modeled";
  - one chain VERSION for every branch: monotonic per branch, as home's
    are, but not separate counters.
- **Its port.** One mock per jest worker (its state is a module's), reset
  between worlds and listening on a new port for each, because `fetch` keeps
  connections open and a closed server answers the next world with a dead
  socket. The socket url it hands out names the port it was imported with,
  so the world points it at the current one (`socketUrl`).
- **A deploy** does not reach the content service, so no `deployment`
  message (see "Code changes, hosted").
- **Real I/O on a fake clock.** Calls to the content host finish in real
  time, so `settle()` also waits until the host has answered everything
  (`drained`), and a Studio's start waits, in real time, for its socket.

## Not there yet

Each of these is a place where a scenario does NOT yet cover the product's
path, and a scenario that depends on it would prove less than it looks:

- **Server modes.** memory, fs and http. fs works in a fresh temporary
  directory that the world makes its working directory for its lifetime,
  because fs mode's project is `process.cwd()` (`initHandlerOptions`);
  `world.dispose()` puts the old one back and removes the directory. http is
  below.
- **The Studio's `/stat` loop.** Real, except for the loop itself: what is
  asked (`requestStat`), what an answer does (`statStateAfterAnswer`), when the
  next ask goes out (`statWait`) and how the answer reaches the stores
  (`statSnapshotOf`) are the functions `useStatus` and `ValStoreProvider` call;
  the dozen lines that string them together are a React effect in the Studio
  and a `while` loop here. fs and memory long-poll; in http the Studio opens
  the content service's socket when `/stat` says `use-websocket`, waits for
  `subscribed` (as the Playwright harness does: the service sends a change
  only to the sockets subscribed when it happens) and takes each message in
  through the hook's own `parseSocketMessage` and
  `statStateAfterSocketMessage`. Its `/stat` is then asked every twenty
  minutes.
- **Typing.** `studio.edit` writes what a string field writes once typing
  pauses. The debounce itself (`useDebouncedFieldWrite`) is not exercised.
- **The page's client half.** `world.loadPage` runs a TanStack page in draft
  mode with the overlay on it, through the functions the provider and
  `useVal` call, and the provider's steps (`draftProp`, `suspend`), which
  are its state as the world moves it: `ValTanStackProvider` moves it in
  effects, so the steps are the world's while the waits they cause are the
  product's (`overlaySource`). Not there: React itself (hydration is a read
  of the store with the client's modules, which is what React would render;
  a read that waits is recorded as a suspension, not rendered), the canvas
  (postMessage) relay -- the same catch-up as the overlay's (`startCatchUp`),
  whose messages `canvasConfirmed.test.tsx` pins with a real system -- and a
  Next page: its provider runs the same pipeline (`createDraftStore`,
  `applyValEvent`, `startRefreshLoop`), but the world's server half is
  TanStack's (`fetchValDraft`, which Next does not have yet), so Next's
  `draft` prop and its refreshes are pinned by `ValNextProvider.draft.test.tsx`.
  The loaders are there: `loaderShows` reads with the real `fetchVal` at the
  server render and on every refresh of the provider's own loop
  (`startRefreshLoop`, from `@valbuild/react/stega`), which refreshes once
  per version the Studio confirms; `page.refreshes` counts them and
  `page.refreshTimes` says when.
- **The clock.** Fake (`world/clock.ts`): jest's timers, with microtasks,
  `nextTick` and `setImmediate` left real. `world.settle()` moves it forward in
  300 ms steps until nothing changes for three in a row, so a parked long poll
  costs nothing and a 20 s one is a few steps. `network.hold` scripts a write
  that lands late (S05), and with `at: "answer"` an answer computed early and
  delivered late (S06).
- **Code changes, hosted.** `world.deployCode` / `studio.receiveCode` are
  how new code arrives in LOCAL DEVELOPMENT: HMR evaluates the server module
  again (`initValServer`, `initValContent`) and `<ValModulesClient>` registers
  the new registry (`loadValModules`, `HostStore.receive`). Hosted, the
  content version and a proposal's snapshot the platform hands a build are
  expressed (`contentVersion`, `proposal` in `WorldOptions`; S20, S21), and so
  is `__VAL_BASE__` on a page. A world can also open a proposal and serve
  its address (`proposal: { open }`), which is what `world.proposal` drives:
  `stage` (the assistant's `write_files`), `redeploy` (a new isolate on the
  overlay a save or a staging made), `merge` (the Studio's
  `pressMerge`), `someonePushes` (a developer's push to `val/p/<name>`,
  through the content host's control plane, with the files it changes),
  `buildOnTheirPush` (the Studio's `buildOnTheirPush`) and `build` (the
  Studio's `buildProposal`, with the bundler at the edge: nothing is
  bundled, and the files it was handed are kept in `built`); `page(route, { at: "site" })` reads the SITE from the same
  world, with the content version the platform would hand it. In http mode
  `deployCode` reports the new build LIVE to the content host (a `success`
  deployment on the branch, as the platform or GitHub reports one), which
  moves `seq` once for it, as valbuild/home does, and puts the `deployment`
  message and the chain at its new version on the socket (S11 "a new build is
  counted"). Not expressed: a deploy BUILDING while an open hosted Studio
  watches (a `pending` deployment first, which is what makes a hosted Studio
  ask `/stat` sooner) -- so the two "why" pins about a deploy,
  `overlayAfterBuild`'s "why it flickers" and S16's, are still skipped on
  http (tried with the `success` alone: both still fail).
  At a proposal's address `world.changeCode(modules, files)` IS the
  assistant's `write_files` (through `runCodeTool`), then the build of it
  served and handed to every Studio.
  The bug the `addedField` scenario reproduces in development is reported for
  the hosted one, where those layers are the likelier cause.
- **A long poll parked on the old server.** After `deployCode`, a `/stat`
  already parked on the previous server instance answers from that instance
  until its 20 s run out (as in a dev server). In memory and fs it names the
  NEW build's base for its chain (`ValOps.chainBaseSha`, S26), as a dev
  server's does; in http the live build's, once the content service has
  heard it went live (`liveBuild`, `relative_to=live`). `settle()` counts a parked poll
  as quiet, so a scenario can end with a Studio still holding what the old
  server said. In `addedField` (b) this is why the field ends `(absent)`
  rather than back on the new base.
- **Invariants.** "Converges" (each surface's last value, and, where the
  frames carry versions, the same version of every module), "never goes
  back" (a value may come back only at a version the surface has not shown,
  or at an older one after `seq` moved past it: the chain really went back),
  "same version, same value" over every frame, and "never with another
  schema" (`frames.expectNeverGoesBack()` checks the last two of these alone,
  where surfaces show different fields), and counted work
  (`studio.expectWork`, `world.expectWork`: version hashes, and the
  server's engine -- `engine:apply-patch` and `engine:clone-bytes`; since phase 5 the Studio
  applies patches with the same engine, and says what was its own through
  `RecordingActivity`). "Events, not timers": since
  phase 4 there is no timer left that refreshes a page (`startRefreshLoop`
  has none, and its unit test says so), and S05 and B08 count every refresh
  and move the clock on a minute to see that none comes from it, in memory,
  fs and http. "No schema dialog" is checked by S16.
- **Versions in the frames.** A loader's version is the server's answer's,
  as the reader says it read it (`readsOfFetchVal`). A Studio's is the one it
  computed (`SourceStore.versionOf`), and a hook's once the overlay relayed
  it the one the relay sent with it (phase 5), so "same version, same value"
  holds the Studio's versions to the server's. A loader's
  `seq` is not known (the reader keeps the module map, not the answer's
  `project`). `fetchValKey` and `fetchValRoute` report nothing, so their
  frames carry no versions. "One version per render" is not checked: a frame
  is one field, and nothing yet reads several modules at once and says so.
