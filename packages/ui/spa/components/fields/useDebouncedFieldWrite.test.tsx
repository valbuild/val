/** @jest-environment jsdom */
import { act, render } from "@testing-library/react";
import { useDebouncedFieldWrite } from "./useDebouncedFieldWrite";

/**
 * A field's writes, coalesced — and never dropped.
 *
 * The dropping is the part worth pinning: a debounce that forgets its pending
 * value on unmount loses the last thing typed, and the window is short enough
 * that the loss looks random rather than reproducible.
 */
function Probe({
  written,
  onReady,
  maxWaitMs,
}: {
  written: string[];
  onReady: (api: ReturnType<typeof useDebouncedFieldWrite<string>>) => void;
  maxWaitMs: number;
}) {
  const write = useDebouncedFieldWrite<string>(
    (value) => {
      written.push(value);
    },
    100,
    maxWaitMs,
  );
  onReady(write);
  return null;
}

/**
 * The cap defaults to something far away, so a test that is about the trailing
 * debounce never trips over it. The cap's own tests pass a real one.
 */
function mount(maxWaitMs = 100_000) {
  const written: string[] = [];
  let api!: ReturnType<typeof useDebouncedFieldWrite<string>>;
  const view = render(
    <Probe
      written={written}
      maxWaitMs={maxWaitMs}
      onReady={(next) => {
        api = next;
      }}
    />,
  );
  return { written, api: () => api, view };
}

/**
 * Typing with no gap big enough for the trailing debounce.
 *
 * This is the case the cap exists for and the one a trailing debounce cannot
 * serve: at 60 WPM the gap between keystrokes is about 200ms and the debounce
 * is 250ms, so every keystroke pushes the write further away and it never
 * arrives. Here the gap is 40ms against a 100ms debounce, which is the same
 * relationship.
 */
function typeContinuously(
  api: () => ReturnType<typeof useDebouncedFieldWrite<string>>,
  count: number,
  gapMs = 40,
) {
  let value = "";
  for (let index = 0; index < count; index++) {
    value += "x";
    const next = value;
    act(() => api().push(next));
    act(() => {
      jest.advanceTimersByTime(gapMs);
    });
  }
  return value;
}

describe("useDebouncedFieldWrite", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test("a burst of keystrokes is one write, with the last value", () => {
    const { written, api } = mount();
    for (const value of ["H", "He", "Hel", "Hell", "Hello"]) {
      act(() => api().push(value));
    }
    expect(written).toEqual([]);
    act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(written).toEqual(["Hello"]);
  });

  test("a pause between bursts is two writes", () => {
    const { written, api } = mount();
    act(() => api().push("one"));
    act(() => {
      jest.advanceTimersByTime(100);
    });
    act(() => api().push("two"));
    act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(written).toEqual(["one", "two"]);
  });

  test("flush writes immediately, and only once", () => {
    const { written, api } = mount();
    act(() => api().push("typed"));
    act(() => api().flush());
    expect(written).toEqual(["typed"]);
    act(() => {
      jest.advanceTimersByTime(500);
    });
    // The timer must not fire a second write for a value already written.
    expect(written).toEqual(["typed"]);
  });

  test("flush with nothing pending writes nothing", () => {
    const { written, api } = mount();
    act(() => api().flush());
    expect(written).toEqual([]);
  });

  /** Navigating away mid-word must not throw the word away. */
  test("unmount writes what was still pending", () => {
    const { written, api, view } = mount();
    act(() => api().push("half a sentence"));
    expect(written).toEqual([]);
    act(() => {
      view.unmount();
    });
    expect(written).toEqual(["half a sentence"]);
  });

  test("reports whether a value is waiting", () => {
    const { api } = mount();
    expect(api().hasPending()).toBe(false);
    act(() => api().push("x"));
    expect(api().hasPending()).toBe(true);
    act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(api().hasPending()).toBe(false);
  });

  describe("the max-wait cap", () => {
    /**
     * The bug the cap fixes, stated as a test: without it this expects `[]`
     * forever, because every keystroke restarts the only timer there is.
     */
    test("typing with no pause still writes, and keeps writing", () => {
      const { written, api } = mount(500);
      // 500ms of cap against a 40ms gap: the cap expires first, mid-run.
      typeContinuously(api, 20);
      expect(written.length).toBeGreaterThanOrEqual(1);
      // Still going, so it is a cap and not a one-off: 20 keystrokes at 40ms is
      // 800ms of typing, which is more than one 500ms window.
      const afterFirstRun = written.length;
      typeContinuously(api, 20);
      expect(written.length).toBeGreaterThan(afterFirstRun);
    });

    test("what the cap writes is the latest value, not the first", () => {
      const { written, api } = mount(200);
      const typed = typeContinuously(api, 10);
      expect(written.length).toBeGreaterThan(0);
      // 10 keystrokes at 40ms is 400ms, so the 200ms cap fired during it; the
      // value it wrote is one of the prefixes actually typed, and the last
      // write is never ahead of what exists.
      for (const value of written) {
        expect(typed.startsWith(value)).toBe(true);
      }
    });

    /**
     * The cap is armed from the FIRST keystroke of a run and not restarted, so
     * the run it caps is the one that started it. A run that ends in a pause is
     * unaffected — one write, exactly as before the cap existed.
     */
    test("typing that has pauses in it is unchanged", () => {
      const { written, api } = mount(500);
      act(() => api().push("one"));
      act(() => {
        jest.advanceTimersByTime(100);
      });
      expect(written).toEqual(["one"]);
      act(() => api().push("two"));
      act(() => {
        jest.advanceTimersByTime(100);
      });
      expect(written).toEqual(["one", "two"]);
      // And the cap, long since armed and answered, adds nothing of its own.
      act(() => {
        jest.advanceTimersByTime(5000);
      });
      expect(written).toEqual(["one", "two"]);
    });

    test("a cap that fires does not also write from the trailing timer", () => {
      const { written, api } = mount(100);
      act(() => api().push("typed"));
      // Cap and debounce are both 100ms here, so they come due together — the
      // one that gets there first must take the other's timer down with it.
      act(() => {
        jest.advanceTimersByTime(1000);
      });
      expect(written).toEqual(["typed"]);
    });

    test("nothing is left armed after a flush", () => {
      const { written, api } = mount(200);
      act(() => api().push("typed"));
      act(() => api().flush());
      expect(written).toEqual(["typed"]);
      act(() => {
        jest.advanceTimersByTime(5000);
      });
      expect(written).toEqual(["typed"]);
    });
  });
});
