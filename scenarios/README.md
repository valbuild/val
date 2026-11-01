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

| File                                 | What it asserts                                                                                                                                                | Today                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `smoke.scenario.test.ts`             | An edit in the Studio reaches a draft page's `fetchVal`; with draft mode off the page keeps the published content                                              | passes, memory and fs                                                                                                                                                                                                                                                                                                                                                                  |
| `twoEditors.scenario.test.ts`        | An edit by one editor reaches the other editor's field through `/stat` and a fetch of the patch                                                                | passes, memory and fs                                                                                                                                                                                                                                                                                                                                                                  |
| `addedField.scenario.test.ts`        | A field added to a schema can be typed into and kept, (a) when the server and the Studio both have the new code, (b) when the Studio gets it before the server | (a) passes; (b) **fails, marked `test.failing`**: the edit is discarded. See the test's comment                                                                                                                                                                                                                                                                                        |
| `overlayAfterBuild.scenario.test.ts` | After a code change and a build, a draft page loaded with the overlay never shows the new content, then the old, then the new                                  | Same build: passes, with and without a pending edit. **Two cases are skipped** (cause known, fix deferred while coverage is built out), each with a running test pinning why: (1) the overlay's `/stat` is answered by the previous build, so the Studio aligns to it and relays its content; (2) the browser runs the previous build's client code, so hydration reads the old bundle |

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
  without the `draft` prop, the `suspend` gates, `.jsonValues()` records in a
  page read, the canvas (postMessage) relay, and the loaders re-running after
  `VAL_EDIT_LANDED` (`router.invalidate`, the refresh loop is not extracted).
- **The clock.** Fake (`world/clock.ts`): jest's timers, with microtasks,
  `nextTick` and `setImmediate` left real. `world.settle()` moves it forward in
  300 ms steps until nothing changes for three in a row, so a parked long poll
  costs nothing and a 20 s one is a few steps. Races are not scripted yet:
  `network.hold` exists, and no scenario uses it.
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
- **Invariants.** "Converges" and "never goes back", on values
  (`frames.expectNeverGoesBack()` alone where surfaces show different fields). The rest of
  the plan's list (one version per render, parity, never with another schema,
  events not timers, no schema dialog) and the counted budgets of work come as
  the scenarios that need them do.
