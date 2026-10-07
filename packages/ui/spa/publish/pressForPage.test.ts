import type {
  PublishRequestStatus,
  PublishTabJob,
} from "@valbuild/shared/internal";
import type { PatchId } from "@valbuild/core";
import type { PressAs, PublishResult } from "../stores/PublishSeam";
import type { StudioJobClient } from "./jobClient";
import type { HandoffIntent } from "./handoff";
import {
  NOT_LOADED_MESSAGE,
  type PressedForPage,
  nothingToBuildMessage,
  pressBuilds,
  pressForPage,
  waitForQueuedJob,
  whenReady,
} from "./pressForPage";
import { createRequestPublish } from "./requestPublish";

/**
 * The press a builder tab makes for the page that opened it. The page cannot:
 * an iPhone pauses it the moment the tab takes the screen, and the tab sat at
 * "Starting the publish" waiting for a press that never went out.
 */

const press: HandoffIntent = {
  kind: "press",
  requestId: "page-r1",
  tab: "page-tab",
};

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
    },
    client: {
      tryAgain: async () => {
        throw new Error("503 Service Unavailable");
      },
    },
    chain: () => [],
    publish: async () => ({ status: "nothing-to-publish" }),
  });
  expect(outcome).toEqual({
    kind: "not-pressed",
    message: "The publish could not be started again. Publish again to retry.",
    details: "503 Service Unavailable",
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
    expect(nothingToBuildMessage({ kind: "publishing" })).toBe(
      "Your changes are publishing with the publish before them.",
    );
    expect(nothingToBuildMessage({ kind: "nothing-to-publish" })).toBe(
      "There was nothing to publish.",
    );
  });
});

describe("a queued press", () => {
  test("asks for its job, as the page, until its turn comes", async () => {
    const asked: string[] = [];
    let turn = 0;
    const waited = await waitForQueuedJob({
      client: {
        next: async (tab) => {
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
    expect(waited).toEqual({ kind: "job", job });
    expect(asked).toEqual(["page-tab", "page-tab", "page-tab"]);
  });

  test("stops asking once another tab's job took it", async () => {
    const waited = await waitForQueuedJob({
      client: {
        next: async () => null,
        requestStatus: async () => ({ kind: "publishing" }),
      },
      requestId: "r1",
      tab: "page-tab",
      stopped: () => false,
      everyMs: 1,
    });
    expect(waited).toEqual({ kind: "moved", request: { kind: "publishing" } });
  });

  test("stops when a job arrived some other way", async () => {
    let stopped = false;
    const waited = await waitForQueuedJob({
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
    expect(waited).toEqual({ kind: "stopped" });
  });

  test("keeps asking through a request that did not get through", async () => {
    let turn = 0;
    const waited = await waitForQueuedJob({
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
    expect(waited).toEqual({ kind: "job", job });
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
