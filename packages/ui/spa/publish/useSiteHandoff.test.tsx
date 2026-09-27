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

/**
 * The page that handed its publish to a Studio tab learns the commit is live
 * from the tab, not from `/stat` -- which in http mode is minutes away.
 */
test("a live publish from the tab names the commit that went live", async () => {
  const opened: string[] = [];
  jest.spyOn(window, "open").mockImplementation((url) => {
    opened.push(String(url));
    return null;
  });
  const live: string[] = [];
  const { result } = renderHook(() =>
    useSiteHandoff({ onLive: (commit) => live.push(commit), enabled: true }),
  );
  act(() => result.current.prepare(true));
  const id = new URL(opened[0], "http://site").searchParams.get(
    "publish-handoff",
  );
  expect(id).not.toBeNull();
  act(() =>
    result.current.commit({ commit: "c1", binaryFiles: null, branch: null }),
  );
  const tab = joinHandoff(id ?? "", () => undefined, { retryMs: 10 });
  try {
    tab.report({
      type: "done",
      result: { status: "live", url: null, visible: true },
      ms: 1_000,
    });
    await waitFor(() => expect(live).toEqual(["c1"]));
  } finally {
    // An open channel keeps jest alive, and a failure would hang instead.
    tab.close();
    act(() => result.current.cancel(""));
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
