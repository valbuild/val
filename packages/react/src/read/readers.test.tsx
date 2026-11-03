/** @jest-environment jsdom */
import React, { act } from "react";
import { render } from "@testing-library/react";
import type { Resolution } from "./resolveVal";
import { useResolved } from "./readers";

/**
 * How a component waits: `useResolved` suspends until what a read waits on is
 * in, then reads again. A whole `.jsonValues()` record waits on every entry
 * it imports; suspended on one at a time, each was a render that resolved the
 * whole read again -- N entries, N renders, N x N work.
 */
test("a read that waits on many things suspends once for all of them", async () => {
  const N = 20;
  const settledBy = new Set<Promise<void>>();
  const waits = Array.from({ length: N }, () => {
    let done = () => {};
    const promise = new Promise<void>((resolve) => {
      done = resolve;
    });
    return { promise, done };
  });
  let resolves = 0;
  const resolve = (settled: ReadonlySet<Promise<void>>): Resolution<string> => {
    resolves++;
    for (const wait of settled) settledBy.add(wait);
    const pending = waits
      .map((wait) => wait.promise)
      .filter((promise) => !settled.has(promise));
    return pending.length === 0
      ? { status: "ready", value: "all in", reads: [] }
      : { status: "pending", ready: pending[0], waits: pending };
  };
  function Reader() {
    return (
      <span>{useResolved({}, { sources: [], encode: false }, resolve)}</span>
    );
  }
  let container: HTMLElement = document.body;
  let unmount = () => {};
  await act(async () => {
    ({ container, unmount } = render(
      <React.Suspense fallback={<span>waiting</span>}>
        <Reader />
      </React.Suspense>,
    ));
  });
  expect(container.textContent).toBe("waiting");
  await act(async () => {
    for (const wait of waits) wait.done();
  });
  expect(container.textContent).toBe("all in");
  // The first render, and the one after everything came in: not one per wait.
  expect(resolves).toBeLessThanOrEqual(4);
  unmount();
});
