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

| Part              | The product code it runs                                                                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Server            | `initValServer` from `@valbuild/tanstack/server`: the route handler an app mounts, in memory or fs mode                                                                  |
| Studio            | `createValSystem`; modules in through `loadValModules`; a `/stat` long poll through `requestStat`, `statStateAfterAnswer` and `statWait`, taken in with `statSnapshotOf` |
| An edit           | `stringFieldPatch` and `patchStore.createPatch`, what a string field calls                                                                                               |
| Page, server half | `initValContent`'s `fetchValStega`, with the same patch store as the API, as an app passes it                                                                            |

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
- **The page's client half.** `useVal`, the overlay store and the relay from
  the Studio are not in the world yet.
- **The clock.** Fake (`world/clock.ts`): jest's timers, with microtasks,
  `nextTick` and `setImmediate` left real. `world.settle()` moves it forward in
  300 ms steps until nothing changes for three in a row, so a parked long poll
  costs nothing and a 20 s one is a few steps. Races are not scripted yet:
  `network.hold` exists, and no scenario uses it.
- **Invariants.** "Converges" and "never goes back", on values. The rest of
  the plan's list (one version per render, parity, never with another schema,
  events not timers, no schema dialog) and the counted budgets of work come as
  the scenarios that need them do.
