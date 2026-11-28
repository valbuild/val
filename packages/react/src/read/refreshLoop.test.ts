import { startRefreshLoop } from "./refreshLoop";

/**
 * When a draft page re-reads its server (`startRefreshLoop`): once per
 * version the Studio says the server has confirmed, and never on a timer.
 * The scenarios drive it with the real relay (S05, B08 in `scenarios/`);
 * these are its rules one at a time.
 */
describe("startRefreshLoop", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  const counting = () => {
    let refreshes = 0;
    const loop = startRefreshLoop({
      refresh: () => {
        refreshes++;
      },
    });
    return { loop, refreshes: () => refreshes };
  };

  test("the first confirmed is the connection: no refresh for a page that is not behind", () => {
    const { loop, refreshes } = counting();
    loop.confirmed(3);
    expect(refreshes()).toBe(0);
  });

  test("the first confirmed refreshes a page the catch-up found behind", () => {
    const { loop, refreshes } = counting();
    loop.changed();
    loop.confirmed(3);
    expect(refreshes()).toBe(1);
  });

  test("an edit arriving is no refresh; its version confirmed is one", () => {
    const { loop, refreshes } = counting();
    loop.confirmed(3);
    // The relay hands the edit over before the server has it.
    loop.changed();
    expect(refreshes()).toBe(0);
    loop.confirmed(4);
    expect(refreshes()).toBe(1);
  });

  test("a version told twice, or late, refreshes once", () => {
    const { loop, refreshes } = counting();
    loop.confirmed(3);
    loop.confirmed(4);
    loop.confirmed(4);
    loop.confirmed(2);
    expect(refreshes()).toBe(1);
    loop.confirmed(5);
    expect(refreshes()).toBe(2);
  });

  test("a version that cannot be ordered (null) refreshes every time", () => {
    const { loop, refreshes } = counting();
    loop.confirmed(null);
    loop.confirmed(null);
    loop.confirmed(null);
    expect(refreshes()).toBe(2);
  });

  test("draft mode turned on or off refreshes at once", () => {
    const { loop, refreshes } = counting();
    loop.refresh();
    expect(refreshes()).toBe(1);
  });

  test("schedules no timer, ever", () => {
    const { loop, refreshes } = counting();
    loop.changed();
    loop.confirmed(1);
    loop.confirmed(2);
    loop.refresh();
    expect(jest.getTimerCount()).toBe(0);
    jest.advanceTimersByTime(10 * 60_000);
    expect(refreshes()).toBe(3);
  });

  test("one refresh in flight: versions confirmed meanwhile are one more, after it", async () => {
    const done: (() => void)[] = [];
    let refreshes = 0;
    const loop = startRefreshLoop({
      refresh: () => {
        refreshes++;
        return new Promise<void>((resolve) => done.push(resolve));
      },
    });
    loop.confirmed(1);
    loop.confirmed(2);
    expect(refreshes).toBe(1);
    loop.confirmed(3);
    loop.confirmed(4);
    expect(refreshes).toBe(1);
    done[0]?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(refreshes).toBe(2);
    done[1]?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(refreshes).toBe(2);
    expect(loop.refreshes).toBe(2);
  });

  test("a refresh that fails does not stop the next one", async () => {
    let refreshes = 0;
    const fails: (() => void)[] = [];
    const loop = startRefreshLoop({
      refresh: () => {
        refreshes++;
        return new Promise<void>((_, reject) => {
          fails.push(() => reject(new Error("the route did not answer")));
        });
      },
    });
    loop.confirmed(1);
    loop.confirmed(2);
    loop.confirmed(3);
    fails[0]?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(refreshes).toBe(2);
  });

  test("stopped, it refreshes nothing", () => {
    const { loop, refreshes } = counting();
    loop.confirmed(1);
    loop.stop();
    loop.confirmed(2);
    loop.refresh();
    expect(refreshes()).toBe(0);
  });

  /**
   * `shown(seq)`: when the page shows the server's content at `seq`, which is
   * when a render id waiting on it is written on the page (`data-val-render`).
   * Its loaders or server components show it once a refresh made AFTER the
   * server confirmed `seq` has come back.
   */
  describe("shown", () => {
    const settles = () => {
      const done: (() => void)[] = [];
      let refreshes = 0;
      const loop = startRefreshLoop({
        refresh: () => {
          refreshes++;
          return new Promise<void>((resolve) => done.push(resolve));
        },
      });
      return { loop, done, refreshes: () => refreshes };
    };
    const tick = async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve();
    };
    const resolved = (promise: Promise<void>) => {
      let is = false;
      void promise.then(() => {
        is = true;
      });
      return () => is;
    };

    test("waits for the refresh of a version at or after it, and for that refresh to come back", async () => {
      const { loop, done } = settles();
      loop.changed();
      const shown = resolved(loop.shown(2));
      loop.confirmed(2);
      await tick();
      expect(shown()).toBe(false);
      done[0]?.();
      await tick();
      expect(shown()).toBe(true);
    });

    test("a version not confirmed yet is not shown", async () => {
      const { loop, done } = settles();
      loop.changed();
      loop.confirmed(1);
      const shown = resolved(loop.shown(2));
      done[0]?.();
      await tick();
      expect(shown()).toBe(false);
      loop.confirmed(2);
      done[1]?.();
      await tick();
      expect(shown()).toBe(true);
    });

    test("a refresh that started before the version was confirmed does not show it", async () => {
      const { loop, done } = settles();
      loop.changed();
      loop.confirmed(1);
      const shown = resolved(loop.shown(2));
      // Confirmed while the refresh of 1 is still out: that one asked a
      // server that may not have had 2.
      loop.confirmed(2);
      done[0]?.();
      await tick();
      expect(shown()).toBe(false);
      done[1]?.();
      await tick();
      expect(shown()).toBe(true);
    });

    test("a page rendered from the draft it was connected at shows that version without a refresh", async () => {
      const { loop, refreshes } = settles();
      loop.confirmed(3);
      const shown = resolved(loop.shown(3));
      await tick();
      expect(refreshes()).toBe(0);
      expect(shown()).toBe(true);
    });

    test("a version already shown resolves at once", async () => {
      const { loop, done } = settles();
      loop.changed();
      loop.confirmed(4);
      done[0]?.();
      await tick();
      const shown = resolved(loop.shown(2));
      await tick();
      expect(shown()).toBe(true);
    });

    test("a refresh that fails still ends: what came back is what is shown", async () => {
      const fails: (() => void)[] = [];
      const loop = startRefreshLoop({
        refresh: () =>
          new Promise<void>((_, reject) => {
            fails.push(() => reject(new Error("the route did not answer")));
          }),
      });
      loop.changed();
      const shown = resolved(loop.shown(1));
      loop.confirmed(1);
      fails[0]?.();
      await tick();
      expect(shown()).toBe(true);
    });

    test("a refresh that cannot say when it is done (Next) shows the version once it is sent", async () => {
      const { loop } = counting();
      loop.changed();
      const shown = resolved(loop.shown(1));
      loop.confirmed(1);
      await tick();
      expect(shown()).toBe(true);
    });

    test("no version (null) is shown once the page is connected and nothing is refreshing", async () => {
      const { loop, done } = settles();
      const shown = resolved(loop.shown(null));
      await tick();
      expect(shown()).toBe(false);
      loop.changed();
      loop.confirmed(1);
      await tick();
      expect(shown()).toBe(false);
      done[0]?.();
      await tick();
      expect(shown()).toBe(true);
    });
  });
});
