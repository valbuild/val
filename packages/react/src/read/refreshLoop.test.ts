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
});
