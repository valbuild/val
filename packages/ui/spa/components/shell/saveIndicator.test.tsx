/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { SaveIndicator } from "./StatusBar";

/**
 * What the status bar says about saving.
 *
 * The resting state used to be "All changes saved locally", which against a
 * project is wrong: the patch is on the content service, which is where it has
 * to be for a colleague to see it and for Publish to ship it. "Locally" reads
 * as "still only on this machine" — the one thing an editor would want to know,
 * said backwards.
 *
 * Pinned as copy because that is the whole of the fix, and because the word is
 * an easy one to put back while "clarifying" the sentence.
 */
describe("the save indicator", () => {
  test("says changes are saved, without claiming where", () => {
    render(<SaveIndicator saveState="saved" />);
    expect(screen.queryByText("All changes saved")).not.toBeNull();
  });

  test("shortens rather than qualifies on a narrow bar", () => {
    render(<SaveIndicator saveState="saved" breakpoint="tablet" />);
    expect(screen.queryByText("Saved")).not.toBeNull();
  });

  test("never says locally", () => {
    const { container } = render(<SaveIndicator saveState="saved" />);
    expect(container.textContent).not.toMatch(/local/i);
  });

  // The other two states are unchanged, and are what the bar is read for when
  // something is wrong.
  test("still says when a save is in flight, and when one failed", () => {
    const { unmount } = render(<SaveIndicator saveState="saving" />);
    expect(screen.queryByText("Saving…")).not.toBeNull();
    unmount();
    render(<SaveIndicator saveState="error" />);
    expect(screen.queryByText("Could not save")).not.toBeNull();
  });
});

/**
 * Every label is always rendered — they share one grid cell so the slot has
 * one width (see `SaveIndicator`) — so finding a label's text says nothing
 * about whether it is the one showing. What decides that is which wrapper is
 * visible and exposed to assistive technology, and that is what this pins.
 */
describe("the save indicator's stacked labels", () => {
  const LABELS = {
    saved: "All changes saved",
    saving: "Saving…",
    error: "Could not save",
  } as const;
  const STATES = ["saved", "saving", "error"] as const;

  /** The wrapper a label sits in: the grid cell that is shown or hidden. */
  function wrapperOf(text: string): HTMLElement {
    const label = screen.getByText(text);
    const wrapper = label.closest("[aria-hidden]");
    if (!(wrapper instanceof HTMLElement)) {
      throw new Error(`"${text}" is not inside a label wrapper`);
    }
    return wrapper;
  }

  test.each(STATES)("shows and announces only the %s label", (state) => {
    render(<SaveIndicator saveState={state} />);
    for (const other of STATES) {
      const wrapper = wrapperOf(LABELS[other]);
      if (other === state) {
        expect(wrapper.getAttribute("aria-hidden")).toBe("false");
        expect(wrapper.classList.contains("invisible")).toBe(false);
      } else {
        expect(wrapper.getAttribute("aria-hidden")).toBe("true");
        expect(wrapper.classList.contains("invisible")).toBe(true);
      }
    }
  });
});
