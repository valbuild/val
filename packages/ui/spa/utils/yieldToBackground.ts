type SchedulerWithPostTask = {
  postTask: (
    callback: () => void,
    options?: { priority?: "user-blocking" | "user-visible" | "background" },
  ) => Promise<unknown>;
};

/**
 * Hands the main thread back to the browser, resuming as background work.
 *
 * Used to time-slice work that is neither interactive nor cancellable in the
 * middle — running the user's custom validate functions, which are arbitrary
 * code we cannot preempt. Slicing means a module with hundreds of flagged nodes
 * cannot freeze the Studio; it does NOT make a single slow validator fast (devs
 * who write slow validators get to see their own slowness).
 *
 * Prefers the real scheduling primitives and degrades: `scheduler.postTask` gives
 * a true background priority, `requestIdleCallback` waits for idle time,
 * `MessageChannel` at least yields a macrotask, and `setTimeout` is the floor
 * (node, tests).
 */
export function yieldToBackground(): Promise<void> {
  const scheduler = (
    globalThis as unknown as { scheduler?: SchedulerWithPostTask }
  ).scheduler;
  if (scheduler && typeof scheduler.postTask === "function") {
    return scheduler
      .postTask(() => undefined, { priority: "background" })
      .then(() => undefined);
  }
  const idle = (
    globalThis as unknown as {
      requestIdleCallback?: (callback: () => void) => number;
    }
  ).requestIdleCallback;
  if (typeof idle === "function") {
    return new Promise((resolve) => idle(() => resolve()));
  }
  if (typeof MessageChannel === "function") {
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        resolve();
      };
      channel.port2.postMessage(null);
    });
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}
