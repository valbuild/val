/** @jest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { useComposerFocusRestore } from "./useComposerFocusRestore";

/**
 * Putting the caret back in the chat composer once the answer lands.
 *
 * The interesting part is not the restore, it is who is allowed to arm it. The
 * flag is consumed on the composer becoming usable again, so arming it for a
 * send that never went out leaves it armed: nothing re-enables the composer
 * until the next reconnect, and the restore then fires long after the user has
 * moved on and takes the caret with it.
 */
function setup() {
  const focus = jest.fn();
  const view = renderHook(
    ({ disabled }: { disabled: boolean }) =>
      useComposerFocusRestore(disabled, focus),
    { initialProps: { disabled: false } },
  );
  return { focus, view };
}

/** The restore is deferred to after paint - see the hook. */
function flushFrame() {
  act(() => {
    jest.advanceTimersByTime(32);
  });
}

describe("useComposerFocusRestore", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test("focuses the composer when it comes back after a send", () => {
    const { focus, view } = setup();
    act(() => view.result.current.armForSend());
    view.rerender({ disabled: true });
    view.rerender({ disabled: false });
    flushFrame();
    expect(focus).toHaveBeenCalledTimes(1);
  });

  test("does nothing when nothing was sent", () => {
    const { focus, view } = setup();
    view.rerender({ disabled: true });
    view.rerender({ disabled: false });
    flushFrame();
    expect(focus).not.toHaveBeenCalled();
  });

  test("a reconnect after the restore does not focus again", () => {
    const { focus, view } = setup();
    act(() => view.result.current.armForSend());
    view.rerender({ disabled: true });
    view.rerender({ disabled: false });
    flushFrame();
    focus.mockClear();
    // The composer goes away and comes back for a reason of its own - a
    // dropped connection, say. The send it was armed for is long done.
    view.rerender({ disabled: true });
    view.rerender({ disabled: false });
    flushFrame();
    expect(focus).not.toHaveBeenCalled();
  });

  test("an arm with no send behind it survives to the next reconnect", () => {
    // Not a wish, a warning: the flag is only ever consumed on the composer
    // coming back, so it cannot expire on its own. That is why `AIChat` arms
    // it on the branch where the message went out and nowhere else - a failed
    // send never disables the composer, and the caret would be stolen here.
    const { focus, view } = setup();
    act(() => view.result.current.armForSend());
    flushFrame();
    expect(focus).not.toHaveBeenCalled();
    view.rerender({ disabled: true });
    view.rerender({ disabled: false });
    flushFrame();
    expect(focus).toHaveBeenCalledTimes(1);
  });

  test("leaves the caret where the user put it", () => {
    const { focus, view } = setup();
    const input = document.createElement("input");
    document.body.appendChild(input);
    act(() => view.result.current.armForSend());
    view.rerender({ disabled: true });
    input.focus();
    view.rerender({ disabled: false });
    flushFrame();
    expect(focus).not.toHaveBeenCalled();
    input.remove();
  });
});
