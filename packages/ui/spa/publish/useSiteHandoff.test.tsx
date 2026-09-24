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
    useSiteHandoff({ onLive: (commit) => live.push(commit) }),
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
