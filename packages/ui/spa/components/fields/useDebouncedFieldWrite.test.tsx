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
}: {
  written: string[];
  onReady: (api: ReturnType<typeof useDebouncedFieldWrite<string>>) => void;
}) {
  const write = useDebouncedFieldWrite<string>((value) => {
    written.push(value);
  }, 100);
  onReady(write);
  return null;
}

function mount() {
  const written: string[] = [];
  let api!: ReturnType<typeof useDebouncedFieldWrite<string>>;
  const view = render(
    <Probe
      written={written}
      onReady={(next) => {
        api = next;
      }}
    />,
  );
  return { written, api: () => api, view };
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
});
