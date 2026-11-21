/**
 * @jest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import {
  QUICK_PREVIEW_PAUSE_MS,
  useCodeModeQuickPreview,
} from "./useCodeModeQuickPreview";
import { createProposalsClient } from "../../proposals/proposalsClient";
import {
  proposalCodeChanged,
  resetProposalBuild,
  setAssistantWorking,
} from "../../proposals/useProposalBuild";
import {
  setStagedPreview,
  stagedPreview,
  waitForStagedPreview,
} from "../../proposals/quickPreviewControl";
import { resetServerBuildsForTests } from "../../proposals/serverFirst";

/*
 * From a staging to its quick preview, COUNTED: the requests made on the
 * way, and the quick previews Val Build is asked for.
 *
 * The network is the only fake: `fetch`, answering as Val's server does for
 * the proposal. The staging goes through the proposals client the assistant's
 * `write_files` stages with (`stageFiles`), and everything after it -- what
 * hears of it, when a quick preview starts, what it is asked with -- is the
 * product's.
 */
const mockProposal = { name: "p1", branch: "val/p/p1" };
jest.mock("../ValProvider", () => ({
  useCurrentProposal: () => mockProposal,
  useStudioDeployState: () => ({ deploy: jest.fn(), state: null }),
}));
jest.mock("../../stores/react/SystemContext", () => ({
  useValSystem: () => ({
    system: {
      manifest: {
        seq: () => 1,
        onSeq: () => () => {},
        servedBuild: () => null,
        onServedBuild: () => () => {},
      },
    },
  }),
}));

/** What content holds of the proposal: one more staging, one more `inputs`. */
let stagings = 0;
const inputsNow = () => (stagings === 0 ? null : `inputs-${stagings}`);
/** Every request made, in order: `GET /p1`, `POST /p1/files`, ... */
let requests: string[] = [];
const quickPreviews = () =>
  requests.filter((request) => request === "POST /p1/quick-preview");

/** As much of a `Response` as the proposals client reads: jsdom has none. */
function json(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => JSON.stringify(body),
  };
}

beforeEach(() => {
  jest.useFakeTimers();
  stagings = 0;
  requests = [];
  resetProposalBuild();
  resetServerBuildsForTests();
  setStagedPreview(null);
  const staged = () => ({
    files: Array.from({ length: stagings }, (_, i) => `src/File${i}.tsx`),
    inputs: inputsNow(),
    buildRequired: stagings > 0,
  });
  (globalThis as { fetch?: unknown }).fetch = async (
    url: string,
    init?: { method?: string; body?: string },
  ) => {
    const path = url.replace("/api/val/proposals-api", "");
    const method = init?.method ?? "GET";
    requests.push(`${method} ${path}`);
    if (method === "GET" && path === "/p1") {
      return json({
        proposal: {
          name: "p1",
          branch: "val/p/p1",
          displayName: "A proposal",
          status: "open",
          updatedAt: "2026-01-01T00:00:00.000Z",
          staged: staged(),
        },
      });
    }
    if (method === "POST" && path === "/p1/files") {
      stagings += 1;
      return json({ commit: `commit-${stagings}`, staged: staged() });
    }
    if (method === "POST" && path === "/p1/quick-preview") {
      const body: unknown = JSON.parse(init?.body ?? "{}");
      const asked =
        typeof body === "object" && body !== null && "inputs" in body
          ? body.inputs
          : undefined;
      return json({ inputs: asked, files: {} });
    }
    throw new Error(`Not this test's network: ${method} ${url}`);
  };
});

afterEach(() => {
  jest.useRealTimers();
});

/** The assistant's write: the client's staging, then the tool saying so. */
async function write(n: number) {
  const client = createProposalsClient({ api: "/api/val" });
  await act(async () => {
    await client.stageFiles("p1", { [`src/File${n}.tsx`]: `// ${n}\n` });
  });
  // `useAI`'s code-tool handler, once the tool has answered.
  act(() => proposalCodeChanged());
}

async function pass(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

async function open() {
  const store = jest.fn(async () => {});
  const hook = renderHook((props) => useCodeModeQuickPreview(props), {
    initialProps: { pageLive: true, buildEpoch: 0 },
  });
  act(() => hook.result.current.setStorer(store));
  // The proposal as it is when the Studio opens on it: nothing staged.
  await pass(0);
  expect(requests).toEqual(["GET /p1"]);
  requests = [];
  return { ...hook, store };
}

/** The page in the canvas says it is the quick preview asked for. */
function pageSaysItIsThere(hook: {
  result: { current: ReturnType<typeof useCodeModeQuickPreview> };
}) {
  const quick = hook.result.current.quickId;
  expect(quick).not.toBeNull();
  act(() => hook.result.current.onDocument({ quick }));
}

describe("from a staging to its quick preview", () => {
  test("nothing is read on the way: the quick preview is asked for with what the staging answered", async () => {
    await open();
    await write(0);
    await pass(0);
    // Before: GET /p1 (to learn the inputs), a second's wait, GET /p1 again
    // (the quick preview learning them once more), then the POST.
    expect(requests).toEqual(["POST /p1/files", "POST /p1/quick-preview"]);
  });

  test("a burst of five writes in a turn is one quick preview, of the last, when the turn ends", async () => {
    const hook = await open();
    act(() => setAssistantWorking(true));
    for (let n = 0; n < 5; n++) {
      await write(n);
      // The model's edits arrive a couple of seconds apart.
      await pass(2_000);
    }
    expect(quickPreviews()).toHaveLength(0);

    act(() => setAssistantWorking(false));
    await pass(0);
    expect(quickPreviews()).toHaveLength(1);
    expect(hook.store).toHaveBeenCalledTimes(1);
    pageSaysItIsThere(hook);
    await pass(0);
    expect(stagedPreview()).toEqual({ inputs: "inputs-5", status: "shown" });
    // Before: five, one a second after each write -- and five more, each
    // asked for again when the page it was shown in came up.
    await pass(10_000);
    expect(quickPreviews()).toHaveLength(1);
  });

  test("a turn that pauses shows what it has so far, once", async () => {
    const hook = await open();
    act(() => setAssistantWorking(true));
    await write(0);
    await pass(1_000);
    await write(1);
    await pass(QUICK_PREVIEW_PAUSE_MS - 1);
    expect(quickPreviews()).toHaveLength(0);
    await pass(1);
    expect(quickPreviews()).toHaveLength(1);
    pageSaysItIsThere(hook);
    // The turn ending adds nothing: what is staged is shown.
    act(() => setAssistantWorking(false));
    await pass(10_000);
    expect(quickPreviews()).toHaveLength(1);
  });

  test("the pause is since the last write, not since the proposal was last read", async () => {
    await open();
    act(() => setAssistantWorking(true));
    await write(0);
    // A build ending, a typecheck reporting: the proposal is read again,
    // again and again, while the turn goes on.
    for (let waited = 0; waited < QUICK_PREVIEW_PAUSE_MS - 500; waited += 500) {
      await pass(500);
      act(() => proposalCodeChanged());
    }
    expect(quickPreviews()).toHaveLength(0);
    // The last of those reads answers, and the pause has half a second left.
    await pass(0);
    await pass(499);
    expect(quickPreviews()).toHaveLength(0);
    await pass(1);
    expect(quickPreviews()).toHaveLength(1);
  });

  test("the page coming up as the quick preview does not ask for it again", async () => {
    const hook = await open();
    await write(0);
    await pass(0);
    expect(quickPreviews()).toHaveLength(1);
    // The canvas loads the page as the quick preview: not live, then live.
    hook.rerender({ pageLive: false, buildEpoch: 0 });
    pageSaysItIsThere(hook);
    hook.rerender({ pageLive: true, buildEpoch: 0 });
    await pass(10_000);
    expect(quickPreviews()).toHaveLength(1);
  });

  test("a write while one is being made is shown after it, never beside it", async () => {
    const hook = await open();
    await write(0);
    await pass(0);
    expect(quickPreviews()).toHaveLength(1);
    // Asked for, handed to the page, and waiting for the page to say it is
    // there, when the next write lands.
    await write(1);
    await pass(0);
    expect(quickPreviews()).toHaveLength(1);
    pageSaysItIsThere(hook);
    await pass(0);
    expect(quickPreviews()).toHaveLength(2);
    expect(hook.store).toHaveBeenCalledTimes(2);
  });

  test("whoever staged the files hears they are shown when the page says it is there, not before", async () => {
    const hook = await open();
    await write(0);
    let heard: string | null = null;
    void waitForStagedPreview("inputs-1", 60_000).then((preview) => {
      heard = preview.status;
    });
    // Asked for, built, handed to the page: none of that is "shown".
    await pass(0);
    expect(quickPreviews()).toHaveLength(1);
    expect(hook.store).toHaveBeenCalledTimes(1);
    expect(heard).toBeNull();
    pageSaysItIsThere(hook);
    await pass(0);
    expect(heard).toBe("shown");
  });

  test("a build served puts the served build back, and files staged before it are shown over it again", async () => {
    const hook = await open();
    await write(0);
    await pass(0);
    pageSaysItIsThere(hook);
    await pass(0);
    expect(quickPreviews()).toHaveLength(1);
    // Someone's build is served, and it is not of what is staged now (the
    // fake still answers `buildRequired`): the canvas goes back to it...
    requests = [];
    hook.rerender({ pageLive: true, buildEpoch: 1 });
    expect(hook.result.current.quickId).toBeNull();
    // ...the proposal is read again to learn what the build left unbuilt,
    // and that is shown over it.
    await pass(0);
    await pass(0);
    expect(requests).toEqual(["GET /p1", "POST /p1/quick-preview"]);
  });
});
