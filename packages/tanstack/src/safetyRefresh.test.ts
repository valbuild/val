import { shouldSafetyRefresh } from "./safetyRefresh";

/**
 * When the page looks again by itself.
 *
 * The reason this is a function and not four lines inside an effect: every
 * `false` here is a whole-route request not made, and in development that is a
 * re-render of the page — so "when do we NOT bother" is the part worth pinning
 * down.
 */
const WINDOW = 30_000;
const MIN = 500;

function state(over: Partial<Parameters<typeof shouldSafetyRefresh>[0]> = {}) {
  return {
    now: 100_000,
    lastEditAt: 95_000,
    lastRefreshAt: 90_000,
    hidden: false,
    isRefreshing: false,
    windowMs: WINDOW,
    minIntervalMs: MIN,
    ...over,
  };
}

describe("shouldSafetyRefresh", () => {
  test("looks again shortly after an edit", () => {
    expect(shouldSafetyRefresh(state())).toBe(true);
  });

  test("does not poll a page nobody has edited", () => {
    expect(shouldSafetyRefresh(state({ lastEditAt: 0 }))).toBe(false);
  });

  test("stops once the editing is well over", () => {
    // One tick inside the window, the next outside it.
    expect(
      shouldSafetyRefresh(state({ lastEditAt: 100_000 - WINDOW + 1 })),
    ).toBe(true);
    expect(
      shouldSafetyRefresh(state({ lastEditAt: 100_000 - WINDOW - 1 })),
    ).toBe(false);
  });

  test("does not refresh a tab nobody is looking at", () => {
    expect(shouldSafetyRefresh(state({ hidden: true }))).toBe(false);
  });

  test("does not stack requests", () => {
    expect(shouldSafetyRefresh(state({ isRefreshing: true }))).toBe(false);
  });

  test("does not follow a refresh that just went out", () => {
    expect(shouldSafetyRefresh(state({ lastRefreshAt: 100_000 - 1 }))).toBe(
      false,
    );
    expect(shouldSafetyRefresh(state({ lastRefreshAt: 100_000 - MIN }))).toBe(
      true,
    );
  });
});
