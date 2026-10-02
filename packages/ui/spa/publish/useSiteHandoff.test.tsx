/** @jest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { joinHandoff } from "./handoff";
import {
  LOST_GRACE_MS,
  TAB_FIRST_WORD_MS,
  TAB_GONE_MESSAGE,
  TAB_SILENT_MS,
  useSiteHandoff,
} from "./useSiteHandoff";
import { RENEW_EVERY_MS } from "./runStudioJob";
import { BroadcastChannel as NodeBroadcastChannel } from "node:worker_threads";

// jsdom has no BroadcastChannel; Node's is the same API.
if (typeof globalThis.BroadcastChannel === "undefined") {
  Object.defineProperty(globalThis, "BroadcastChannel", {
    value: NodeBroadcastChannel,
    configurable: true,
  });
}

/** A renewal content accepts. */
const renewed = async () => true;

const job = {
  id: "J1",
  step: "prepare" as const,
  base: null,
  patches: ["p1"],
};

/**
 * The page that handed its publish job to a Studio tab waits for the tab's
 * part of it -- the job runner goes on from there. The tab's part ends at the
 * upload: content checks the site renders and puts it live without it, so the
 * tab closes, and the card follows the page's OWN tracker to Live.
 */
test("the tab runs the job as this page, and answers with its part of it", async () => {
  const opened: string[] = [];
  jest.spyOn(window, "open").mockImplementation((url) => {
    opened.push(String(url));
    return null;
  });
  const { result } = renderHook(() => useSiteHandoff({ enabled: true }));
  act(() => result.current.prepare(true));
  const id = new URL(opened[0], "http://site").searchParams.get(
    "publish-handoff",
  );
  expect(id).not.toBeNull();
  let running!: Promise<unknown>;
  act(() => {
    running = result.current.runJob(job, "site-tab", "r1", renewed);
  });
  const heard: unknown[] = [];
  const tab = joinHandoff(id ?? "", (message) => heard.push(message), {
    retryMs: 10,
  });
  try {
    await waitFor(() =>
      expect(heard).toContainEqual({
        type: "job",
        job,
        tab: "site-tab",
        requestId: "r1",
      }),
    );
    tab.report({
      type: "job-result",
      result: { status: "handed-off", jobId: "J1", built: true },
    });
    await expect(running).resolves.toEqual({
      status: "handed-off",
      jobId: "J1",
      built: true,
    });
    // Content has it: the card says so, and waits on this page's tracker.
    await waitFor(() =>
      expect(result.current.state).toEqual({ kind: "checking" }),
    );
    expect(result.current.active()).toBe(false);
    // Another request settling is not this one.
    act(() => result.current.settled("r0", { kind: "live", commit: "c0" }));
    expect(result.current.state).toEqual({ kind: "checking" });
    act(() => result.current.settled("r1", { kind: "live", commit: "c1" }));
    expect(result.current.state).toMatchObject({
      kind: "live",
      followed: true,
    });
  } finally {
    // An open channel keeps jest alive, and a failure would hang instead.
    tab.close();
    act(() => result.current.cancel(""));
  }
});

test("a handoff given up on answers `lost`, so the job goes back to the queue", async () => {
  jest.spyOn(window, "open").mockImplementation(() => null);
  const { result } = renderHook(() => useSiteHandoff({ enabled: true }));
  act(() => result.current.prepare(true));
  let running!: Promise<unknown>;
  act(() => {
    running = result.current.runJob(job, "site-tab", "r1", renewed);
  });
  act(() => result.current.dismiss());
  await expect(running).resolves.toEqual({ status: "lost", jobId: "J1" });
  expect(result.current.active()).toBe(false);
});

test("a lease content refuses to renew ends the wait as `lost`", async () => {
  jest.useFakeTimers();
  try {
    jest.spyOn(window, "open").mockImplementation(() => null);
    const { result } = renderHook(() => useSiteHandoff({ enabled: true }));
    act(() => result.current.prepare(true));
    let settled: unknown = null;
    act(() => {
      void result.current
        .runJob(job, "site-tab", "r1", async () => false)
        .then((r) => (settled = r));
    });
    // The renewal is refused; the tab gets its grace to report first.
    await act(() => jest.advanceTimersByTimeAsync(RENEW_EVERY_MS));
    expect(settled).toBeNull();
    await act(() => jest.advanceTimersByTimeAsync(LOST_GRACE_MS));
    expect(settled).toEqual({ status: "lost", jobId: "J1" });
    act(() => result.current.cancel(""));
  } finally {
    jest.useRealTimers();
  }
});

test("a renewal that did not get through is not a lost job", async () => {
  jest.useFakeTimers();
  try {
    jest.spyOn(window, "open").mockImplementation(() => null);
    const { result } = renderHook(() => useSiteHandoff({ enabled: true }));
    act(() => result.current.prepare(true));
    let settled: unknown = null;
    act(() => {
      void result.current
        .runJob(job, "site-tab", "r1", () =>
          Promise.reject(new Error("offline")),
        )
        .then((r) => (settled = r));
    });
    await act(() => jest.advanceTimersByTimeAsync(3 * RENEW_EVERY_MS));
    expect(settled).toBeNull();
    act(() => result.current.cancel(""));
    await act(() => Promise.resolve());
    expect(settled).toEqual({ status: "lost", jobId: "J1" });
  } finally {
    jest.useRealTimers();
  }
});

test("a provider that may not hand off never opens a tab", () => {
  const open = jest.spyOn(window, "open").mockImplementation(() => null);
  open.mockClear();
  const { result } = renderHook(() => useSiteHandoff());
  act(() => result.current.prepare(true));
  expect(open).not.toHaveBeenCalled();
  expect(result.current.active()).toBe(false);
  expect(result.current.state).toBeNull();
});

test("a page that can build publishes in place, and never opens a tab", () => {
  const open = jest.spyOn(window, "open").mockImplementation(() => null);
  open.mockClear();
  Object.defineProperty(globalThis, "crossOriginIsolated", {
    value: true,
    configurable: true,
  });
  try {
    const { result } = renderHook(() => useSiteHandoff({ enabled: true }));
    act(() => result.current.prepare(true));
    expect(open).not.toHaveBeenCalled();
    expect(result.current.active()).toBe(false);
  } finally {
    Object.defineProperty(globalThis, "crossOriginIsolated", {
      value: undefined,
      configurable: true,
    });
  }
});

test("a page that cannot build -- WebKit's Studio -- opens the builder tab", () => {
  const open = jest.spyOn(window, "open").mockImplementation(() => null);
  open.mockClear();
  const { result } = renderHook(() => useSiteHandoff({ enabled: true }));
  act(() => result.current.prepare(true));
  expect(open).toHaveBeenCalledTimes(1);
  expect(String(open.mock.calls[0]?.[0])).toMatch(/\/val\?publish-handoff=/);
  act(() => result.current.cancel(""));
});

test("the builder opens as a popup window, and a re-open reuses it", () => {
  const open = jest.spyOn(window, "open").mockImplementation(() => null);
  open.mockClear();
  const { result } = renderHook(() => useSiteHandoff({ enabled: true }));
  act(() => result.current.prepare(true));
  // Blocked: the card offers the button, which opens the SAME window.
  act(() => result.current.openStudio());
  expect(open).toHaveBeenCalledTimes(2);
  const [first, again] = open.mock.calls;
  expect(again?.[0]).toBe(first?.[0]);
  expect(again?.[1]).toBe(first?.[1]);
  for (const call of [first, again]) {
    expect(String(call?.[2]).split(",")).toContain("popup");
    expect(String(call?.[2])).not.toMatch(/noopener/);
  }
  act(() => result.current.cancel(""));
});

test("a re-open the browser blocks too keeps offering the button", () => {
  jest.spyOn(window, "open").mockImplementation(() => null);
  const { result } = renderHook(() => useSiteHandoff({ enabled: true }));
  act(() => result.current.prepare(true));
  try {
    expect(result.current.state).toEqual({ kind: "blocked" });
    act(() => result.current.openStudio());
    expect(result.current.state).toEqual({ kind: "blocked" });
  } finally {
    // An open channel keeps jest alive, and a failure would hang instead.
    act(() => result.current.cancel(""));
  }
});

test("a re-open the browser allows says it is opening", () => {
  const open = jest.spyOn(window, "open").mockImplementation(() => null);
  const { result } = renderHook(() => useSiteHandoff({ enabled: true }));
  act(() => result.current.prepare(true));
  try {
    open.mockImplementation(() => window);
    act(() => result.current.openStudio());
    expect(result.current.state).toEqual({ kind: "opening" });
  } finally {
    act(() => result.current.cancel(""));
  }
});

test("a handed-off publish that fails says why, in content's words", async () => {
  const opened: string[] = [];
  jest.spyOn(window, "open").mockImplementation((url) => {
    opened.push(String(url));
    return null;
  });
  const { result } = renderHook(() => useSiteHandoff({ enabled: true }));
  act(() => result.current.prepare(true));
  const id = new URL(opened[0], "http://site").searchParams.get(
    "publish-handoff",
  );
  // Before anything is handed off, a settled request is not followed.
  const before = result.current.state;
  act(() => result.current.settled("r1", { kind: "live", commit: "c0" }));
  expect(result.current.state).toEqual(before);
  let running!: Promise<unknown>;
  act(() => {
    running = result.current.runJob(job, "site-tab", "r1", renewed);
  });
  const heard: unknown[] = [];
  const tab = joinHandoff(id ?? "", (message) => heard.push(message), {
    retryMs: 10,
  });
  try {
    await waitFor(() => expect(heard.length).toBeGreaterThan(0));
    tab.report({
      type: "job-result",
      result: { status: "handed-off", jobId: "J1", built: true },
    });
    await running;
    await waitFor(() =>
      expect(result.current.state).toEqual({ kind: "checking" }),
    );
    act(() =>
      result.current.settled("r1", {
        kind: "failed",
        message: "verify failed 3 times: a page failed to render",
        actions: ["try-again"],
        job: "J1",
      }),
    );
    expect(result.current.state).toEqual({
      kind: "failed",
      message: "verify failed 3 times: a page failed to render",
      followed: true,
    });
  } finally {
    tab.close();
    act(() => result.current.cancel(""));
  }
});

/*
 * A tab that goes away -- closed, or suspended by a phone -- before it hands
 * the job on. The page waited for it for ever: it kept renewing the job's
 * lease, and the card stayed at "running" with nothing to dismiss, so the
 * Publish button stayed held and the editor was stuck until they reloaded.
 * Silence now ends the wait: the lease lapses, the card says what happened,
 * and the next press publishes.
 */
describe("a tab that stops answering", () => {
  // The channel delivers on the real event loop, so it is waited for in real time.
  const realSetTimeout = globalThis.setTimeout;
  const flush = async () => {
    for (let i = 0; i < 3; i++)
      await new Promise((resolve) => realSetTimeout(resolve, 5));
  };
  beforeEach(() => {
    jest.useFakeTimers();
    // A window that opened: the browser did not block it.
    jest.spyOn(window, "open").mockImplementation((url) => {
      opened.push(String(url));
      return window;
    });
  });
  afterEach(() => {
    jest.useRealTimers();
    opened.length = 0;
  });
  const opened: string[] = [];

  test("one that never said a word is given up after the Studio's load time", async () => {
    const { result } = renderHook(() => useSiteHandoff({ enabled: true }));
    act(() => result.current.prepare(true));
    expect(result.current.state).toEqual({ kind: "opening" });
    let running!: Promise<unknown>;
    act(() => {
      running = result.current.runJob(job, "site-tab", "r1", renewed);
    });
    // Still loading, as far as the page can tell.
    await act(async () => {
      jest.advanceTimersByTime(TAB_SILENT_MS + 5_000);
    });
    expect(result.current.state).toEqual({ kind: "opening" });
    await act(async () => {
      jest.advanceTimersByTime(TAB_FIRST_WORD_MS);
    });
    expect(result.current.state).toEqual({
      kind: "failed",
      message: TAB_GONE_MESSAGE,
    });
    // The job is let go, and nothing holds the Publish button.
    await expect(running).resolves.toMatchObject({ status: "lost" });
    expect(result.current.active()).toBe(false);
  });

  test("one that answered and then went quiet is given up sooner, and one that keeps saying it is alive is not", async () => {
    const { result } = renderHook(() => useSiteHandoff({ enabled: true }));
    act(() => result.current.prepare(true));
    const id = new URL(opened[0], "http://site").searchParams.get(
      "publish-handoff",
    );
    let running!: Promise<unknown>;
    act(() => {
      running = result.current.runJob(job, "site-tab", "r1", renewed);
    });
    const tab = joinHandoff(id ?? "", () => {}, { retryMs: 10 });
    try {
      // Alive, for well past the silence limit.
      for (let s = 0; s < 3 * TAB_SILENT_MS; s += 2_000) {
        await act(async () => {
          jest.advanceTimersByTime(2_000);
          await flush();
        });
      }
      expect(result.current.state?.kind).not.toBe("failed");
      // Closed without a word.
      tab.close();
      await act(async () => {
        jest.advanceTimersByTime(TAB_SILENT_MS + 4_000);
        await flush();
      });
      expect(result.current.state).toEqual({
        kind: "failed",
        message: TAB_GONE_MESSAGE,
      });
      await expect(running).resolves.toMatchObject({ status: "lost" });
    } finally {
      tab.close();
      act(() => result.current.cancel(""));
    }
  });
});
