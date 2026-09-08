/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { TopBar } from "./TopBar";

/**
 * The order of the three actions in the top bar.
 *
 * Review, Preview, Publish — left to right in the order someone shipping a
 * change does them: see what changed, look at it on the page, send it. Review
 * used to sit between Preview and Publish, which put the step you do FIRST in
 * the middle of the other two.
 *
 * Pinned as DOM order rather than as a class name because that is what decides
 * both the reading order and the tab order, and it is the thing a later edit to
 * this group can break without touching anything that looks like layout.
 */
function topBar(props: Partial<Parameters<typeof TopBar>[0]> = {}) {
  return (
    <TopBar
      breakpoint="desktop"
      projectName="acme/marketing-site"
      openPanel={null}
      onTogglePanel={() => undefined}
      onOpenMenu={() => undefined}
      onOpenSearch={() => undefined}
      onPreview={() => undefined}
      onCompare={() => undefined}
      onPublish={() => undefined}
      pendingChanges={3}
      reviewCount={3}
      {...props}
    />
  );
}

/** True when `first` comes before `second` in the document. */
function precedes(first: Element, second: Element): boolean {
  return (
    (first.compareDocumentPosition(second) &
      Node.DOCUMENT_POSITION_FOLLOWING) !==
    0
  );
}

describe("Review, Preview, Publish", () => {
  test("Review comes before Preview", () => {
    render(topBar());
    expect(
      precedes(
        screen.getByRole("button", { name: "Review 3 changes" }),
        screen.getByRole("button", { name: "Preview" }),
      ),
    ).toBe(true);
  });

  test("Preview comes before Publish", () => {
    render(topBar());
    expect(
      precedes(
        screen.getByRole("button", { name: "Preview" }),
        screen.getByRole("button", { name: /^Publish/ }),
      ),
    ).toBe(true);
  });

  test("the space Review holds is to the left of Preview too", () => {
    // Nothing pending: the button is invisible but still in the layout, so the
    // bar must not reflow when the first change lands. See `ReviewButton`.
    render(topBar({ pendingChanges: 0, reviewCount: 0 }));
    /*
     * By label, not by role, and this is the one query that works.
     *
     * With nothing pending the button carries `aria-hidden`, and the
     * accessible NAME of an element hidden from the accessibility tree
     * computes as the empty string — so
     * `getByRole("button", { name: "Review changes", hidden: true })` matches
     * nothing, `hidden: true` included: that option widens which elements are
     * considered, not how their names are computed. `getByLabelText` reads the
     * `aria-label` attribute itself, which is unaffected.
     */
    const review = screen.getByLabelText("Review changes");
    expect(
      precedes(review, screen.getByRole("button", { name: "Preview" })),
    ).toBe(true);
  });
});
