# Scenarios

Val's real server, the Studio's real stores and a page's real readers, run
together in one jest process, with the network and the framework's request
context in the test's hands. Every scenario is checked against the same
invariants, so an edge case is a script of actions rather than a new set of
assertions. The plan this belongs to is
[`docs/plans/one-content-model.md`](../docs/plans/one-content-model.md)
(phase 0).

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

| Part              | The product code it runs                                                                                                                                                                                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server            | `initValServer` from `@valbuild/tanstack/server`: the route handler an app mounts, in memory or fs mode                                                                                                                                                                                                       |
| Studio            | `createValSystem`; modules in through `loadValModules`; a `/stat` long poll through `requestStat`, `statStateAfterAnswer` and `statWait`, taken in with `statSnapshotOf`                                                                                                                                      |
| An edit           | `stringFieldPatch` and `patchStore.createPatch`, what a string field calls                                                                                                                                                                                                                                    |
| Page, server half | `initValContent`'s `fetchValStega`, with the same patch store as the API, as an app passes it                                                                                                                                                                                                                 |
| A page load       | `world.loadPage`: `fetchValDraft` (the server render), `createDraftStore` (the server's and the browser's store), the overlay's Studio from the page's client modules and `window.__VAL_BASE__`, `startOverlayRelay` → `applyValEvent`, read with `overlaySourceOf` / `readWithOverlay` (what `useVal` reads) |
| Two builds        | `world.deployCode` returns the previous and the new handler; `network.routeBy` picks one per request (a rollout); the log says which answered (`Exchange.to`)                                                                                                                                                 |

## The scenarios

| File                                 | What it asserts                                                                                                                                                                                                                               | Today                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `smoke.scenario.test.ts`             | An edit in the Studio reaches a draft page's `fetchVal`; with draft mode off the page keeps the published content                                                                                                                             | passes, memory and fs                                                                                                                                                                                                                                                                                                                                                                                        |
| `twoEditors.scenario.test.ts`        | An edit by one editor reaches the other editor's field through `/stat` and a fetch of the patch                                                                                                                                               | passes, memory and fs                                                                                                                                                                                                                                                                                                                                                                                        |
| `addedField.scenario.test.ts`        | A field added to a schema can be typed into and kept, (a) when the server and the Studio both have the new code, (b) when the Studio gets it before the server                                                                                | (a) passes; (b) **fails, marked `test.failing`**: the edit is discarded. See the test's comment                                                                                                                                                                                                                                                                                                              |
| `overlayAfterBuild.scenario.test.ts` | After a code change and a build, a draft page loaded with the overlay never shows the new content, then the old, then the new                                                                                                                 | Same build: passes, with and without a pending edit. **Two cases are skipped** (cause known, fix deferred while coverage is built out), each with a running test pinning why: (1) the overlay's `/stat` is answered by the previous build, so the Studio aligns to it and relays its content; (2) the browser runs the previous build's client code, so hydration reads the old bundle                       |
| `sync.scenario.test.ts`              | S05 a refresh that lands before the write; S07 a discard in the middle of the chain reaches every reader; S08 the write after a discard; S09 a publish while a draft page is open                                                             | S07, S08, S09 pass, memory and fs. **S05 is skipped**, with a running test pinning why: the edit reaches the page's store at once, which re-runs the loaders against a server that does not have the write yet; when it lands nothing tells the page, so the loader stays old until the 10 s safety net                                                                                                      |
| `contentShapes.scenario.test.ts`     | S17 an edit inside an unloaded `.jsonValues()` entry; S18 an upload's `patch_id` reaches the page where the file lands (a video poster); S19 a gallery-backed field whose gallery changes                                                     | S18, S19 pass, memory and fs. S17 passes too, since F1 and F2 were fixed                                                                                                                                                                                                                                                                                                                                     |
| `readers.scenario.test.ts`           | S22 the loader, the hook and the Studio field agree; S23 draft at SSR with no flash of published content                                                                                                                                      | pass, memory and fs. S22 is the end state ("converges"); the stronger form, same version same value, needs versions on the wire (phase 1)                                                                                                                                                                                                                                                                    |
| `codeChanges.scenario.test.ts`       | S11 a schema change while the page shows an edit; S12 a module whose code throws is reported; S13 a removed module disappears; S14 edits that no longer fit a new schema are kept; S16 no schema dialog after a deploy the Studio has not got | S11, S12 and S13 pass (S12: a module whose code throws is kept as it was, and the editor is told which; S13: an intake replaces, so a removed module goes). **S14, S16 are skipped**, each with a running test pinning today's behaviour: an edit that no longer applies is deleted, on the server too; `SchemaFreshnessWatch` reports the schema out of date (by design today; the plan removes the dialog) |
| `budgets.scenario.test.ts`           | B01 a keystroke applies its patch once, even after the echo; B02 another editor's keystroke costs one patch, not the module                                                                                                                   | pass, memory and fs, counted with the stores' `RecordingActivity` (`studio.expectWork`)                                                                                                                                                                                                                                                                                                                      |
| `matrix.*.scenario.test.ts`          | The content-shape matrix: shape × operation × surface, in memory and fs. See below                                                                                                                                                            | every surface that works passes; every one that does not is `test.failing`, named after its cause (`(fails today: R1)`)                                                                                                                                                                                                                                                                                      |

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

| What the editor does                             | Function                                                                                                              |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| New entry / delete entry (record popovers)       | `recordAddPatch`, `recordRemovePatch` (`components/recordPatches.ts`)                                                 |
| Rename a key                                     | `renameRecordEntry` (`components/useRenameRecordEntry.ts`)                                                            |
| Upload into, alt text in, delete from a library  | `galleryRef`, `galleryUploadPatch`, `galleryAltPatch`, `galleryRemovePatch` (`fields/galleryPatches.ts`)              |
| Pick from a library                              | `mediaPickPatch` (`fields/mediaPickPatch.ts`)                                                                         |
| Upload into a plain image or file field          | `createFilePatch` (`fields/createFilePatch.ts`)                                                                       |
| A video, a library video, a poster               | `createVideoPatch`, `createVideosetEntryPatch`, `createPosterPatch` (already plain functions)                         |
| What `useVal` / `useValKey` / `useValRoute` read | `readSelectorWithOverlay`, `readEntryWithOverlay`, `readRouteEntryWithOverlay` (`tanstack/src/client/overlayRead.ts`) |

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

| Operation                                       | studio | fetchVal                 | fetchValKey              | fetchValRoute            | useVal                   | useValKey                | useValRoute              | fetchVal keys | useVal keys | entry file on disk | studio, opened after | never goes back, no errors |
| ----------------------------------------------- | ------ | ------------------------ | ------------------------ | ------------------------ | ------------------------ | ------------------------ | ------------------------ | ------------- | ----------- | ------------------ | -------------------- | -------------------------- |
| edit an entry (/blog/a)                         | ok     | ok                       | ok                       | ok                       | ok                       | ok                       | ok                       | —             | —           | —                  | —                    | ok                         |
| add an entry (/blog/c)                          | ok     | ok                       | ok                       | ok                       | ok                       | ok                       | ok                       | ok            | ok          | —                  | —                    | ok                         |
| rename a key (/blog/z)                          | ok     | ok                       | ok                       | ok                       | ok                       | ok                       | ok                       | ok            | ok          | —                  | —                    | ok                         |
| delete an entry (/blog/b)                       | ok     | ok                       | ok                       | ok                       | ok                       | ok                       | ok                       | ok            | ok          | —                  | —                    | ok                         |
| discard an edit (/blog/a)                       | ok     | ok                       | ok                       | ok                       | ok                       | ok                       | ok                       | —             | —           | —                  | —                    | ok                         |
| publish an edit (/blog/a)                       | ok     | ok (fs), **R1** (memory) | ok (fs), **R1** (memory) | ok (fs), **R1** (memory) | ok (fs), **R1** (memory) | ok (fs), **R1** (memory) | ok (fs), **R1** (memory) | —             | —           | ok                 | —                    | ok (fs), **R1** (memory)   |
| another editor's edit, via /stat (/blog/a)      | ok     | ok                       | ok                       | ok                       | ok                       | ok                       | ok                       | —             | —           | —                  | —                    | ok                         |
| a code change to the item schema (/blog/a)      | ok     | ok                       | ok                       | ok                       | ok                       | ok                       | ok                       | —             | —           | —                  | —                    | ok                         |
| an edit to an entry nobody has loaded (/blog/a) | —      | ok                       | ok                       | ok                       | ok                       | ok                       | ok                       | —             | —           | —                  | ok                   | ok                         |

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

- **R1** (high). In memory mode, after a publish the page's readers keep the
  pre-publish content: `initValContent`'s own server instance does not adopt
  the publish, only the API's instance that handled `/save` does. fs mode is
  right once the dev server reloads the rewritten files (below). The plan's
  one runtime per process (phase 6) removes the second instance.
- **F1, fixed.** A draft `fetchVal` of a WHOLE `.jsonValues()` record filled
  its entries from the bundle's imports, so every operation that changed an
  entry's content showed the published entry there. In the draft tree an
  edited entry is still a marker; `fetchVal` now reads the entries a pending
  patch touches from the server (`draftJsonValuesRecord`, in both bindings),
  as `fetchValKey` reads one, and the rest from the bundle.
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
  back" catches: that is R1.
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
- **Remote media** (`.remote()`): needs the content host, which is http
  mode.

### Catalogue ids not built, and why

- **S06** `/stat` answers out of order: in fs and memory a Studio has one
  `/stat` in flight at a time and neither mode checks a write's parent
  (`ValOpsFS`, `ValOpsMemory` ignore `parentRef`), so an out-of-order answer
  has nothing to break. It matters in http mode (a websocket, `headVersion`),
  which the world does not have.
- **S15** a build with other `@valbuild/*` versions: one jest process runs
  one Val.
- **S20, S21** hosted layers (a content version newer than the bundle; a
  proposal's overlay): `initValServer` in memory mode ignores `proposal` and
  `contentVersion` (`initHandlerOptions` returns before reading them) while
  `initValContent`'s readers apply them (`snapshotForReaders`) in any mode,
  so modelling them without http mode would give the API and the readers two
  different bases -- the world would invent a bug. They need http mode and a
  content service that serves proposals; `e2e/mock-content-host` has none.
- **S24** without `suspend`, nothing suspends: the three `suspend` gates are
  still inside `useValStega` (React), not a plain function the world can
  call.
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

## Not there yet

Each of these is a place where a scenario does NOT yet cover the product's
path, and a scenario that depends on it would prove less than it looks:

- **Server modes.** memory and fs. fs works in a fresh temporary directory
  that the world makes its working directory for its lifetime, because fs
  mode's project is `process.cwd()` (`initHandlerOptions`); `world.dispose()`
  puts the old one back and removes the directory. http needs
  `e2e/mock-content-host` started in-process.
- **The Studio's `/stat` loop.** Real, except for the loop itself: what is
  asked (`requestStat`), what an answer does (`statStateAfterAnswer`), when the
  next ask goes out (`statWait`) and how the answer reaches the stores
  (`statSnapshotOf`) are the functions `useStatus` and `ValStoreProvider` call;
  the dozen lines that string them together are a React effect in the Studio
  and a `while` loop here. No websocket: fs and memory long-poll, and http
  (which uses one) is not in the world yet.
- **Typing.** `studio.edit` writes what a string field writes once typing
  pauses. The debounce itself (`useDebouncedFieldWrite`) is not exercised.
- **The page's client half.** `world.loadPage` runs a TanStack page in draft
  mode with the overlay on it, through the functions the provider and
  `useVal` call. Not there: React itself (hydration is a read of the store
  with the client's modules, which is what React would render), a page
  without the `draft` prop, the `suspend` gates, a HOOK reading a whole
  `.jsonValues()` record (its entries are filled through `React.use`), and
  the canvas (postMessage) relay. The loaders are there: `loaderShows` reads
  with the real `fetchVal` at the server render and on every refresh of the
  provider's own loop (`startRefreshLoop`).
- **The clock.** Fake (`world/clock.ts`): jest's timers, with microtasks,
  `nextTick` and `setImmediate` left real. `world.settle()` moves it forward in
  300 ms steps until nothing changes for three in a row, so a parked long poll
  costs nothing and a 20 s one is a few steps. `network.hold` scripts a write
  that lands late (S05); reordering answers is not built (see S06).
- **Code changes, hosted.** `world.deployCode` / `studio.receiveCode` are
  how new code arrives in LOCAL DEVELOPMENT: HMR evaluates the server module
  again (`initValServer`, `initValContent`) and `<ValModulesClient>` registers
  the new registry (`loadValModules`, `HostStore.receive`). The hosted
  proposal is not expressed: the content version and overlay the platform
  hands a build, `__VAL_BASE__`, stagings by the assistant's `write_files`.
  The bug the `addedField` scenario reproduces in development is reported for
  the hosted one, where those layers are the likelier cause.
- **A long poll parked on the old server.** After `deployCode`, a `/stat`
  already parked on the previous server instance answers from that instance
  until its 20 s run out (as in a dev server). `settle()` counts a parked poll
  as quiet, so a scenario can end with a Studio still holding what the old
  server said. In `addedField` (b) this is why the field ends `(absent)`
  rather than back on the new base.
- **Invariants.** "Converges" (each surface's last value) and "never goes
  back", on values (`frames.expectNeverGoesBack()` alone where surfaces show
  different fields), and counted work (`studio.expectWork`). One version per
  render, parity at a version and never with another schema need versions in
  the frames (phase 1); "events, not timers" and "no schema dialog" are
  checked by the scenarios that need them (S05, S16).
