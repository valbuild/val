import { setTimeout as realSleep } from "node:timers/promises";

/**
 * The world's clock: jest's fake timers, so the product's own waits -- the
 * server's 20 second long poll, fs mode's 250 ms check of the patch log, the
 * save loop's back-off -- happen when the world moves time forward, not in
 * real seconds. The clock is an edge, like the network: nothing in Val is
 * changed to make time controllable.
 *
 * `nextTick`, `queueMicrotask` and `setImmediate` stay real: promises and the
 * streams under `fetch`'s `Response` run on them, and faking them would stop
 * the world rather than slow it.
 */
export type Clock = {
  /** Move time forward, then let real I/O (fs mode's files) finish. */
  advance(ms: number): Promise<void>;
  /** Back to real timers. */
  stop(): void;
};

export function startFakeClock(): Clock {
  jest.useFakeTimers({
    doNotFake: ["nextTick", "queueMicrotask", "setImmediate"],
  });
  return {
    async advance(ms) {
      await jest.advanceTimersByTimeAsync(ms);
      // `node:timers/promises` is not the global `setTimeout`, so it is not
      // faked: a real millisecond or two for the file system to answer.
      for (let i = 0; i < 3; i++) {
        await realSleep(1);
      }
    },
    stop() {
      jest.useRealTimers();
    },
  };
}
