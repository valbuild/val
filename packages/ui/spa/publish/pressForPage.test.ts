import type {
  PublishRequestStatus,
  PublishTabJob,
} from "@valbuild/shared/internal";
import type { PatchId } from "@valbuild/core";
import type { PressAs, PublishResult } from "../stores/PublishSeam";
import type { StudioJobClient } from "./jobClient";
import { StudioPublishError } from "./publishClient";
import {
  askServerAbout,
  hasChange,
  newestUnpublished,
  followRequest,
  NOT_LOADED_MESSAGE,
  type PressedForPage,
  type PressIntent,
  pressBuilds,
  pressedAlready,
  pressForPage,
  rememberedEnding,
  rememberEnding,
  settledMessage,
  waitForChange,
  whenReady,
} from "./pressForPage";
import { createRequestPublish } from "./requestPublish";

/**
 * The press a builder tab makes for the page that opened it. The page cannot:
 * an iPhone pauses it the moment the tab takes the screen, and the tab sat at
 * "Starting the publish" waiting for a press that never went out.
 */

const press: PressIntent = {
  kind: "press",
  requestId: "page-r1",
  tab: "page-tab",
  after: null,
};

/** No waiting between retries: what is tested is whether there is one. */
const noWait = [0, 0, 0];

const job: PublishTabJob = {
  id: "J1",
  step: "prepare",
  base: null,
  patches: ["p1"],
};

const requested = (
  pressAs: PressAs,
  request: PublishRequestStatus,
  withJob: PublishTabJob | null,
): PublishResult => ({
  status: "requested",
  requestId: pressAs.requestId,
  request,
  job: withJob,
  patchIds: ["p1" as PatchId],
});

const noTryAgain: Pick<StudioJobClient, "tryAgain"> = {
  tryAgain: async () => {
    throw new Error("not a try again");
  },
};

test("the tab presses as the page, under the request id the page minted", async () => {
  const pressedAs: PressAs[] = [];
  const outcome = await pressForPage({
    intent: press,
    client: noTryAgain,
    chain: () => ["p1"],
    publish: async (pressAs) => {
      pressedAs.push(pressAs);
      return requested(pressAs, { kind: "publishing" }, job);
    },
  });
  expect(pressedAs).toEqual([{ requestId: "page-r1", tab: "page-tab" }]);
  expect(outcome).toEqual({
    kind: "pressed",
    requestId: "page-r1",
    request: { kind: "publishing" },
    job,
    patchIds: ["p1"],
    replaces: null,
  });
});

test("an edit that landed while the gate ran is checked again, once", async () => {
  const results: PublishResult[] = [
    { status: "refused", reason: "chain-moved" },
    { status: "refused", reason: "chain-moved" },
  ];
  let calls = 0;
  const outcome = await pressForPage({
    intent: press,
    client: noTryAgain,
    chain: () => [],
    publish: async () => results[calls++] ?? results[0]!,
  });
  expect(calls).toBe(2);
  expect(outcome).toMatchObject({ kind: "not-pressed" });
});

test("a refusal is said in the editor's words, with what to look at", async () => {
  const outcome = await pressForPage({
    intent: press,
    client: noTryAgain,
    chain: () => [],
    publish: async () => ({
      status: "refused",
      reason: "validation-errors",
      modules: [],
    }),
  });
  expect(outcome).toEqual({
    kind: "not-pressed",
    message: "Cannot publish: some modules have validation errors.",
    details: "",
    // The same press would be refused again: a tab opened again says so.
    durable: true,
  });
});

test("nothing pending is nothing to publish", async () => {
  const outcome = await pressForPage({
    intent: press,
    client: noTryAgain,
    chain: () => [],
    publish: async () => ({ status: "nothing-to-publish" }),
  });
  expect(outcome).toEqual({
    kind: "not-pressed",
    message: "There was nothing to publish.",
    durable: true,
    nothingToPublish: true,
  });
});

test("a try again resumes content's queue as the page, with no gate", async () => {
  const tried: string[] = [];
  const outcome = await pressForPage({
    intent: {
      kind: "try-again",
      requestId: "page-r2",
      tab: "page-tab",
      replaces: "page-r1",
      after: null,
    },
    client: {
      tryAgain: async (requestId, tab) => {
        tried.push(`${requestId} as ${tab}`);
        return { request: { kind: "publishing" }, job };
      },
    },
    chain: () => ["p1", "p2"],
    publish: async () => {
      throw new Error("a try again runs no gate");
    },
  });
  expect(tried).toEqual(["page-r2 as page-tab"]);
  expect(outcome).toEqual({
    kind: "pressed",
    requestId: "page-r2",
    request: { kind: "publishing" },
    job,
    patchIds: ["p1", "p2"],
    replaces: "page-r1",
  });
});

test("a try again content refused is said, with content's words as details", async () => {
  const outcome = await pressForPage({
    intent: {
      kind: "try-again",
      requestId: "page-r2",
      tab: "page-tab",
      replaces: "page-r1",
      after: null,
    },
    client: {
      tryAgain: async () => {
        throw new StudioPublishError(503, "503 Service Unavailable", null);
      },
    },
    retryMs: noWait,
    chain: () => [],
    publish: async () => ({ status: "nothing-to-publish" }),
  });
  expect(outcome).toEqual({
    kind: "not-pressed",
    message: "The publish could not be started again. Publish again to retry.",
    details: "503 Service Unavailable",
    // No answer is not an answer: opened again, the tab asks content.
    durable: false,
  });
});

test("the seam presses for the page when told to, and as itself otherwise", async () => {
  const presses: string[] = [];
  const client: Pick<StudioJobClient, "press"> = {
    press: async (requestId, tab) => {
      presses.push(`${requestId} as ${tab}`);
      return { request: { kind: "queued" }, job: null };
    },
  };
  const request = createRequestPublish(
    { ...fakeJobClient(), ...client },
    "builder-tab",
  );
  await request({ requestId: "page-r1", tab: "page-tab" });
  await request();
  expect(presses[0]).toBe("page-r1 as page-tab");
  expect(presses[1]).toMatch(/ as builder-tab$/);
});

describe("what a press leaves the tab", () => {
  const pressed = (
    request: PublishRequestStatus,
    withJob: PublishTabJob | null,
  ): PressedForPage => ({
    kind: "pressed",
    requestId: "r1",
    request,
    job: withJob,
    patchIds: [],
    replaces: null,
  });

  test("a job to build, or a queued press whose job is coming", () => {
    expect(pressBuilds(pressed({ kind: "publishing" }, job))).toBe(true);
    expect(pressBuilds(pressed({ kind: "queued" }, null))).toBe(true);
  });

  test("nothing, when it joined a job in flight or settled at once", () => {
    expect(pressBuilds(pressed({ kind: "publishing" }, null))).toBe(false);
    expect(pressBuilds(pressed({ kind: "nothing-to-publish" }, null))).toBe(
      false,
    );
    // A job with no step for a tab: CI's to build.
    expect(
      pressBuilds(pressed({ kind: "publishing" }, { ...job, step: null })),
    ).toBe(false);
  });
});

describe("a press already made, followed", () => {
  test("asks for its job, as the page, until its turn comes", async () => {
    const asked: string[] = [];
    let turn = 0;
    const followed = await followRequest({
      client: {
        next: async (tab: string) => {
          asked.push(tab);
          return ++turn < 3 ? null : job;
        },
        requestStatus: async () => ({ kind: "queued" }),
      },
      requestId: "r1",
      tab: "page-tab",
      stopped: () => false,
      everyMs: 1,
    });
    expect(followed).toEqual({ kind: "job", job });
    expect(asked).toEqual(["page-tab", "page-tab", "page-tab"]);
  });

  test("takes its build up again once a reloaded tab's lease has lapsed", async () => {
    // Content says `publishing` until a tab asking for work lets it see the
    // lapsed lease and put the job back: then that tab gets it.
    let lapsed = false;
    const followed = await followRequest({
      client: {
        next: async () => {
          if (!lapsed) {
            lapsed = true;
            return null;
          }
          return job;
        },
        requestStatus: async () => ({ kind: "publishing" }),
      },
      requestId: "r1",
      tab: "page-tab",
      stopped: () => false,
      everyMs: 1,
    });
    expect(followed).toEqual({ kind: "job", job });
  });

  test("ends with the result once it has settled", async () => {
    let reads = 0;
    const followed = await followRequest({
      client: {
        next: async () => null,
        requestStatus: async () =>
          ++reads < 3 ? { kind: "publishing" } : { kind: "live", commit: "c1" },
      },
      requestId: "r1",
      tab: "page-tab",
      stopped: () => false,
      everyMs: 1,
    });
    expect(followed).toEqual({
      kind: "settled",
      request: { kind: "live", commit: "c1" },
    });
  });

  test("stops when a job arrived some other way", async () => {
    let stopped = false;
    const followed = await followRequest({
      client: {
        next: async () => {
          stopped = true;
          return job;
        },
        requestStatus: async () => ({ kind: "queued" }),
      },
      requestId: "r1",
      tab: "page-tab",
      stopped: () => stopped,
      everyMs: 1,
    });
    expect(followed).toEqual({ kind: "stopped" });
  });

  test("keeps asking through requests that did not get through", async () => {
    let turn = 0;
    const followed = await followRequest({
      client: {
        next: async () => {
          turn++;
          if (turn === 1) throw new Error("offline");
          return job;
        },
        requestStatus: async () => {
          throw new Error("offline");
        },
      },
      requestId: "r1",
      tab: "page-tab",
      stopped: () => false,
      everyMs: 1,
    });
    expect(followed).toEqual({ kind: "job", job });
  });
});

/*
 * A tab opened again -- reloaded, gone back to, the URL reopened -- asks
 * content first, and shows the publish rather than making it again.
 */
describe("a tab opened again", () => {
  test("finds the press it already made", async () => {
    await expect(
      pressedAlready({
        client: { requestStatus: async () => ({ kind: "live", commit: "c1" }) },
        requestId: "r1",
      }),
    ).resolves.toEqual({ kind: "live", commit: "c1" });
  });

  test("presses when content has never heard of the request", async () => {
    let asked = 0;
    await expect(
      pressedAlready({
        client: {
          requestStatus: async () => {
            asked++;
            throw new StudioPublishError(404, "No such request", null);
          },
        },
        requestId: "r1",
        retryMs: noWait,
      }),
    ).resolves.toBeNull();
    expect(asked).toBe(1);
  });

  test("asks again when content could not be reached, then presses anyway", async () => {
    let asked = 0;
    await expect(
      pressedAlready({
        client: {
          requestStatus: async () => {
            asked++;
            throw new TypeError("Load failed");
          },
        },
        requestId: "r1",
        retryMs: noWait,
      }),
    ).resolves.toBeNull();
    // A press is idempotent on its id, so pressing after this is safe.
    expect(asked).toBe(4);
  });

  test("says how a settled publish ended", () => {
    expect(settledMessage({ kind: "live", commit: "c1" })).toEqual({
      live: true,
    });
    expect(
      settledMessage({
        kind: "failed",
        message: "verify failed: / answered 500",
        actions: ["try-again"],
        job: "J1",
      }),
    ).toEqual({ live: false, message: "verify failed: / answered 500" });
    expect(settledMessage({ kind: "nothing-to-publish" })).toEqual({
      live: false,
      message: "There was nothing to publish.",
    });
  });
});

describe("what a tab remembers of its own ending", () => {
  const storage = (): Storage => {
    const items = new Map<string, string>();
    return {
      get length() {
        return items.size;
      },
      clear: () => items.clear(),
      getItem: (key) => items.get(key) ?? null,
      key: (index) => [...items.keys()][index] ?? null,
      removeItem: (key) => void items.delete(key),
      setItem: (key, value) => void items.set(key, value),
    };
  };

  test("a refusal and an update are shown again, by hand-off id", () => {
    const store = storage();
    rememberEnding(
      "h1",
      { kind: "not-pressed", message: "Cannot publish: errors." },
      store,
    );
    rememberEnding(
      "h2",
      { kind: "update", outcome: { status: "current" } },
      store,
    );
    expect(rememberedEnding("h1", store)).toEqual({
      kind: "not-pressed",
      message: "Cannot publish: errors.",
    });
    expect(rememberedEnding("h2", store)).toEqual({
      kind: "update",
      outcome: { status: "current" },
    });
    expect(rememberedEnding("h3", store)).toBeNull();
  });

  test("forgets after a week, and is not the reason a tab breaks", () => {
    const store = storage();
    const day = 24 * 60 * 60_000;
    rememberEnding("old", { kind: "not-pressed", message: "a" }, store, 0);
    rememberEnding(
      "new",
      { kind: "not-pressed", message: "b" },
      store,
      8 * day,
    );
    expect(rememberedEnding("old", store)).toBeNull();
    expect(rememberedEnding("new", store)).not.toBeNull();
    store.setItem("val-publish-handoff-endings", "{not json");
    expect(rememberedEnding("new", store)).toBeNull();
    expect(rememberedEnding("x", null)).toBeNull();
  });
});

describe("waiting for the project to load", () => {
  test("presses once it has", async () => {
    let checks = 0;
    await expect(whenReady(() => ++checks > 2, { everyMs: 1 })).resolves.toBe(
      true,
    );
  });

  test("gives up, and says so, rather than pressing an empty chain", async () => {
    await expect(
      whenReady(() => false, { everyMs: 1, timeoutMs: 5 }),
    ).resolves.toBe(false);
    expect(NOT_LOADED_MESSAGE).toMatch(/nothing was published/);
  });
});

function fakeJobClient(): StudioJobClient {
  const unused = async () => {
    throw new Error("not used");
  };
  return {
    press: unused,
    tryAgain: unused,
    requestStatus: unused,
    next: unused,
    prepare: unused,
    step: unused,
    renew: unused,
    cancel: unused,
    discard: unused,
    newestCiRun: unused,
  };
}

/*
 * Retried when asking again could get past it, and only then: a press is
 * idempotent on its request id, so pressing again is safe -- but a refusal is
 * an answer, and asking again only delays saying it.
 */
describe("a press that did not get through", () => {
  const failed = (retryable: boolean): PublishResult => ({
    status: "failed",
    message: "fetch failed",
    retryable,
  });

  test("is pressed again, as the same press, until it does", async () => {
    const pressedAs: PressAs[] = [];
    const outcome = await pressForPage({
      intent: press,
      client: noTryAgain,
      chain: () => [],
      retryMs: noWait,
      publish: async (pressAs) => {
        pressedAs.push(pressAs);
        return pressedAs.length < 3
          ? failed(true)
          : requested(pressAs, { kind: "publishing" }, job);
      },
    });
    expect(outcome.kind).toBe("pressed");
    expect(new Set(pressedAs.map((p) => p.requestId))).toEqual(
      new Set(["page-r1"]),
    );
  });

  test("gives up after the last retry, and is not remembered as an answer", async () => {
    let calls = 0;
    const outcome = await pressForPage({
      intent: press,
      client: noTryAgain,
      chain: () => [],
      retryMs: noWait,
      publish: async () => {
        calls++;
        return failed(true);
      },
    });
    expect(calls).toBe(4);
    // Content may have taken the press and lost only the answer: a tab
    // opened again must ask, not repeat this.
    expect(outcome).toMatchObject({ kind: "not-pressed", durable: false });
  });

  test("is not pressed again when content answered", async () => {
    let calls = 0;
    await pressForPage({
      intent: press,
      client: noTryAgain,
      chain: () => [],
      retryMs: noWait,
      publish: async () => {
        calls++;
        return failed(false);
      },
    });
    expect(calls).toBe(1);
  });

  test("a try again content refused is not asked again", async () => {
    let calls = 0;
    const outcome = await pressForPage({
      intent: {
        kind: "try-again",
        requestId: "page-r2",
        tab: "page-tab",
        replaces: "page-r1",
        after: null,
      },
      client: {
        tryAgain: async () => {
          calls++;
          throw new StudioPublishError(409, "Not a failed request", null);
        },
      },
      chain: () => [],
      retryMs: noWait,
      publish: async () => ({ status: "nothing-to-publish" }),
    });
    expect(calls).toBe(1);
    expect(outcome).toMatchObject({
      kind: "not-pressed",
      details: "Not a failed request",
    });
  });

  test("a try again that did not get through is asked again", async () => {
    let calls = 0;
    const outcome = await pressForPage({
      intent: {
        kind: "try-again",
        requestId: "page-r2",
        tab: "page-tab",
        replaces: "page-r1",
        after: null,
      },
      client: {
        tryAgain: async () => {
          if (++calls < 2) throw new TypeError("Load failed");
          return { request: { kind: "publishing" }, job };
        },
      },
      chain: () => [],
      retryMs: noWait,
      publish: async () => ({ status: "nothing-to-publish" }),
    });
    expect(calls).toBe(2);
    expect(outcome.kind).toBe("pressed");
  });
});

/*
 * The page names its newest change at the tap, and the tab waits to see it on
 * the server: a change made just before Publish is usually still being saved,
 * and the tab presses what the server has.
 */
describe("the page's last change", () => {
  const store = (
    chain: string[],
    shipped: string[] = [],
    local: string[] = [],
  ) => ({
    allRecords: () => chain.map((patchId) => ({ patchId })),
    pendingAmong: (ids: Iterable<string>) =>
      new Set([...ids].filter((id) => !shipped.includes(id))),
    isPending: (id: string) => local.includes(id),
  });

  test("is the newest one not yet published, saved or not", () => {
    expect(newestUnpublished(store(["p1", "p2", "p3"]))).toBe("p3");
    expect(newestUnpublished(store(["p1", "p2"], ["p2"]))).toBe("p1");
    expect(newestUnpublished(store(["p1"], ["p1"]))).toBeNull();
    expect(newestUnpublished(store([]))).toBeNull();
  });

  test("is there once the tab's chain has it, saved", () => {
    expect(hasChange(store(["p1"]), null)).toBe(true);
    expect(hasChange(store(["p1"]), "p2")).toBe(false);
    expect(hasChange(store(["p1", "p2"]), "p2")).toBe(true);
    // Still only on this tab: not something content can publish yet.
    expect(hasChange(store(["p1", "p2"], [], ["p2"]), "p2")).toBe(false);
  });
});

/*
 * A change another publish took before the tab loaded is never in a fresh
 * tab's chain, so the tab asks the server rather than wait out the deadline
 * over a change that is already live.
 */
describe("waiting for the page's last change", () => {
  test("ends when it arrives in the chain", async () => {
    let polls = 0;
    await expect(
      waitForChange({
        inChain: () => ++polls > 3,
        serverState: async () => "absent",
        everyMs: 1,
        askEveryMs: 1,
      }),
    ).resolves.toBe("arrived");
  });

  test("ends when the server says another publish shipped it", async () => {
    let asked = 0;
    await expect(
      waitForChange({
        inChain: () => false,
        serverState: async () => (++asked < 2 ? "absent" : "shipped"),
        everyMs: 1,
        askEveryMs: 1,
      }),
    ).resolves.toBe("shipped");
  });

  test("does not take a server it could not ask as an answer", async () => {
    await expect(
      waitForChange({
        inChain: () => false,
        serverState: async () => "unknown",
        everyMs: 1,
        askEveryMs: 1,
        timeoutMs: 20,
      }),
    ).resolves.toBe("timed-out");
  });

  test("asks the server only as often as it is told to", async () => {
    let asked = 0;
    await waitForChange({
      inChain: () => false,
      serverState: async () => {
        asked++;
        return "pending";
      },
      everyMs: 1,
      askEveryMs: 60_000,
      timeoutMs: 30,
    });
    expect(asked).toBe(1);
  });

  test("a tab with no store to ask knows nothing", async () => {
    await expect(askServerAbout(null, "p1")).resolves.toBe("unknown");
  });
});
