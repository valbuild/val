/** @jest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import type { SaveState } from "./StatusBar";
import { SAVED_SETTLE_MS, useSteadySaveState } from "./useSteadySaveState";

/**
 * The status bar's save state does not blink while someone types.
 *
 * A field writes on every pause in typing, so the raw "is a write in flight"
 * flips a few times a second. Drawn as it was, "All changes saved" and
 * "Saving…" swapped about forty times in ten seconds of typing — some for a
 * few dozen milliseconds. A burst of writes now reads as one save.
 */
describe("the steady save state", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function setup(initial: SaveState) {
    return renderHook(({ raw }) => useSteadySaveState(raw), {
      initialProps: { raw: initial },
    });
  }

  test("shows a write the moment it starts", () => {
    const hook = setup("saved");
    hook.rerender({ raw: "saving" });
    expect(hook.result.current).toBe("saving");
  });

  test("stays on saving through the gaps between the writes of a burst", () => {
    const hook = setup("saved");
    for (let write = 0; write < 5; write++) {
      hook.rerender({ raw: "saving" });
      act(() => jest.advanceTimersByTime(100));
      hook.rerender({ raw: "saved" });
      act(() => jest.advanceTimersByTime(SAVED_SETTLE_MS - 200));
      expect(hook.result.current).toBe("saving");
    }
  });

  test("settles on saved once the writes have stopped", () => {
    const hook = setup("saved");
    hook.rerender({ raw: "saving" });
    hook.rerender({ raw: "saved" });
    act(() => jest.advanceTimersByTime(SAVED_SETTLE_MS));
    expect(hook.result.current).toBe("saved");
  });

  test("never holds back an error, nor holds one after it is gone", () => {
    const hook = setup("saving");
    hook.rerender({ raw: "error" });
    expect(hook.result.current).toBe("error");
    hook.rerender({ raw: "saved" });
    expect(hook.result.current).toBe("saved");
  });
});
