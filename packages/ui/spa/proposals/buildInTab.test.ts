import { joinHandoff, storedHandoffIntent } from "../publish/handoff";
import type { ProposalJson } from "./proposalsClient";
import {
  buildInTab,
  NOT_STORED_BUILD_MESSAGE,
  TAB_GONE_MESSAGE,
  TAB_NEVER_HEARD_MS,
  TAB_SILENT_MS,
} from "./buildInTab";

/**
 * A proposal's code built in a builder tab, from a page that cannot build:
 * Safari, and every browser on an iPhone (valbuild/home
 * `docs/hosted-publishing.md`). A proposal's code is built wherever it is
 * changed from, so this is how those browsers build -- over a real
 * `BroadcastChannel`, with the tab's end played by `joinHandoff`.
 */
const NAME = "0123456789abcdef0123";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
  };
}

const proposal = (built: string | null, required: boolean): ProposalJson => ({
  name: NAME,
  branch: `val/p/${NAME}`,
  displayName: "Spring",
  status: "open",
  updatedAt: "2026-10-14T10:00:00.000Z",
  built: built === null ? null : { hash: built, inputs: "i1" },
  staged: { files: ["src/Hero.tsx"], inputs: "i1", buildRequired: required },
});

const wait = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

/** A clock and an interval the test moves by hand. */
function manualTime() {
  let at = 1_000_000;
  const ticks = new Set<() => void>();
  return {
    now: () => at,
    every: (tick: () => void) => {
      ticks.add(tick);
      return () => ticks.delete(tick);
    },
    advance: async (ms: number) => {
      at += ms;
      for (const tick of [...ticks]) tick();
      await wait();
    },
  };
}

test("the tab is opened in the tap, told which proposal to build, and its ending is the build's", async () => {
  const storage = memoryStorage();
  const opened: string[] = [];
  const read = jest.fn(async () => proposal("b1", false));
  const time = manualTime();
  const building = buildInTab(
    NAME,
    { get: read },
    {
      open: (url) => {
        opened.push(url);
        return {};
      },
      storage,
      onTab: () => {},
      ...time,
    },
  );
  expect(opened).toHaveLength(1);
  const id = new URL(opened[0], "https://p.example.com").searchParams.get(
    "publish-handoff",
  );
  if (id === null) throw new Error("no hand-off id in the url");
  expect(storedHandoffIntent(id, storage)?.intent).toEqual({
    kind: "build-proposal",
    name: NAME,
  });

  const tab = joinHandoff(id, () => undefined, { retryMs: 10 });
  tab.report({
    type: "proposal-built",
    outcome: { status: "built", hash: "b1" },
  });
  expect(await building).toMatchObject({ status: "built", hash: "b1" });
  tab.close();
});

test("a failed build in the tab is the build's failure, in its words", async () => {
  const storage = memoryStorage();
  let url = "";
  const building = buildInTab(
    NAME,
    { get: async () => proposal(null, true) },
    {
      open: (at) => {
        url = at;
        return {};
      },
      storage,
      onTab: () => {},
      ...manualTime(),
    },
  );
  const id = new URL(url, "https://p.example.com").searchParams.get(
    "publish-handoff",
  );
  if (id === null) throw new Error("no hand-off id in the url");
  const tab = joinHandoff(id, () => undefined, { retryMs: 10 });
  tab.report({
    type: "proposal-built",
    outcome: { status: "failed", message: "The bundler stopped." },
  });
  expect(await building).toEqual({
    status: "failed",
    message: "The bundler stopped.",
  });
  tab.close();
});

/*
 * On an iPhone the tab takes the screen and this page is paused until it is
 * back: the tab's last word can be lost. A quiet tab is not a failure until
 * content says the proposal is still not built.
 */
describe("a tab that goes quiet", () => {
  test("whose build landed is a build, as content says", async () => {
    const time = manualTime();
    let url = "";
    const building = buildInTab(
      NAME,
      { get: async () => proposal("b2", false) },
      {
        open: (at) => {
          url = at;
          return {};
        },
        storage: memoryStorage(),
        onTab: () => {},
        ...time,
      },
    );
    const id = new URL(url, "https://p.example.com").searchParams.get(
      "publish-handoff",
    );
    if (id === null) throw new Error("no hand-off id in the url");
    // It said it was building, and then nothing: the page was paused.
    const tab = joinHandoff(id, () => undefined, {
      retryMs: 10,
      aliveMs: 60_000,
    });
    tab.report({ type: "phase", label: "Building", elapsedMs: 0 });
    await wait(50);
    tab.close();
    await time.advance(TAB_SILENT_MS + 1);
    expect(await building).toMatchObject({ status: "built", hash: "b2" });
  });

  test("whose build did not land says so, and how to build again", async () => {
    const time = manualTime();
    const building = buildInTab(
      NAME,
      { get: async () => proposal(null, true) },
      { open: () => ({}), storage: memoryStorage(), onTab: () => {}, ...time },
    );
    // Never heard from at all: waited for, for a while, and then not.
    await time.advance(TAB_SILENT_MS + 1);
    let settled = false;
    void building.then(() => (settled = true));
    await wait();
    expect(settled).toBe(false);
    await time.advance(TAB_NEVER_HEARD_MS);
    expect(await building).toEqual({
      status: "failed",
      message: TAB_GONE_MESSAGE,
    });
  });
});

test("a browser that will not store the intent opens no tab, and says what to do", async () => {
  const opened: string[] = [];
  const outcome = await buildInTab(
    NAME,
    { get: async () => proposal(null, true) },
    {
      open: (url) => {
        opened.push(url);
        return {};
      },
      storage: null,
      onTab: () => {},
      ...manualTime(),
    },
  );
  expect(opened).toEqual([]);
  expect(outcome).toEqual({
    status: "failed",
    message: NOT_STORED_BUILD_MESSAGE,
  });
});
