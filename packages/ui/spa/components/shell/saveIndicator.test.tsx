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
