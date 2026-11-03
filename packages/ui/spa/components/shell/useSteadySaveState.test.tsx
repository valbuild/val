/** @jest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import type { SaveState } from "./StatusBar";
import {
  SAVED_SETTLE_MS,
  saveStateOf,
  useSteadySaveState,
} from "./useSteadySaveState";
import type { PatchId } from "@valbuild/core";
import {
  SAVE_STUCK_AFTER_ATTEMPTS,
  type SyncState,
} from "../../stores/PatchSync";

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

/**
 * What the save state IS, before it is held steady.
 *
 * It used to be read from "are there unsaved patches" and "is the service
 * down", and neither is the write queue. So a save the server refused, whose
 * patch was then dropped, left nothing unsaved -- and the bar said "All
 * changes saved" over an edit that had just been lost. The queue is read now,
 * and these pin the rule: never "saved" while a save has failed or is pending.
 */
describe("the save state", () => {
  const rest = {
    unsavedCount: 0,
    hasPatchErrors: false,
    serviceUnavailable: false,
  };
  const failed: SyncState = {
    status: "failed",
    patches: ["p-1" as PatchId],
    message: "The content service answered with an error.",
    attempt: 2,
  };

  test("is saved only when the queue is in sync and nothing is unsaved", () => {
    expect(saveStateOf({ ...rest, sync: { status: "in-sync" } })).toBe("saved");
  });

  test("is an error while the content service will not take a save", () => {
    expect(saveStateOf({ ...rest, unsavedCount: 1, sync: failed })).toBe(
      "error",
    );
  });

  test("is an error even if the patches have somehow left the store", () => {
    // The shape of the original bug: nothing unsaved, and a failed queue.
    expect(saveStateOf({ ...rest, unsavedCount: 0, sync: failed })).toBe(
      "error",
    );
  });

  test("is an error once a retry has gone on long enough to be reported", () => {
    expect(
      saveStateOf({
        ...rest,
        unsavedCount: 1,
        sync: {
          status: "retrying",
          patches: ["p-1" as PatchId],
          reason: "network-error",
          message: "fetch failed",
          attempt: SAVE_STUCK_AFTER_ATTEMPTS,
        },
      }),
    ).toBe("error");
  });

  test("is saving through a first, quick retry", () => {
    expect(
      saveStateOf({
        ...rest,
        unsavedCount: 1,
        sync: {
          status: "retrying",
          patches: ["p-1" as PatchId],
          reason: "server-error",
          message: "The content service answered with an error.",
          attempt: 1,
        },
      }),
    ).toBe("saving");
  });

  test("is saving while a write is queued or in flight, never saved", () => {
    for (const sync of [
      { status: "pending", patches: ["p-1" as PatchId] },
      { status: "saving", patches: ["p-1" as PatchId] },
    ] satisfies SyncState[]) {
      expect(saveStateOf({ ...rest, unsavedCount: 0, sync })).toBe("saving");
    }
    expect(
      saveStateOf({ ...rest, unsavedCount: 1, sync: { status: "in-sync" } }),
    ).toBe("saving");
  });

  test("is an error for a patch error or a service that is down", () => {
    expect(
      saveStateOf({
        ...rest,
        hasPatchErrors: true,
        sync: { status: "in-sync" },
      }),
    ).toBe("error");
    expect(
      saveStateOf({
        ...rest,
        serviceUnavailable: true,
        sync: { status: "in-sync" },
      }),
    ).toBe("error");
  });
});
