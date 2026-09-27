/** @jest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { joinHandoff } from "./handoff";
import { useSiteHandoff } from "./useSiteHandoff";
import { BroadcastChannel as NodeBroadcastChannel } from "node:worker_threads";

// jsdom has no BroadcastChannel; Node's is the same API.
if (typeof globalThis.BroadcastChannel === "undefined") {
  Object.defineProperty(globalThis, "BroadcastChannel", {
    value: NodeBroadcastChannel,
    configurable: true,
  });
}

const job = {
  id: "J1",
  step: "prepare" as const,
  base: null,
  patches: ["p1"],
};

/**
 * The page that handed its publish job to a Studio tab waits for the tab's
 * part of it -- the job runner goes on from there -- and the card follows the
 * tab to Live.
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
    running = result.current.runJob(job, "site-tab", "r1", () => {});
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
      result: { status: "handed-off", jobId: "J1" },
    });
    await expect(running).resolves.toEqual({
      status: "handed-off",
      jobId: "J1",
    });
    tab.report({
      type: "done",
      result: { status: "live", url: null },
      ms: 1_000,
    });
    await waitFor(() =>
      expect(result.current.state).toEqual({ kind: "live", ms: 1_000 }),
    );
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
    running = result.current.runJob(job, "site-tab", "r1", () => {});
  });
  act(() => result.current.dismiss());
  await expect(running).resolves.toEqual({ status: "lost", jobId: "J1" });
  expect(result.current.active()).toBe(false);
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
