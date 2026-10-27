/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { UtilityPanel } from "./UtilityPanel";

/**
 * The Discard all confirm, and where it renders.
 *
 * Radix portals a popover to `document.body` unless it is given a container.
 * The Studio lives inside a shadow root, and `index.css` is linked INTO that
 * root — so a popup that lands in `document.body` renders with none of Val's
 * styles. It is in the DOM, it is just invisible, which from the outside looks
 * exactly like a button that does nothing. That is what shipped.
 *
 * `ValPortalProvider` owns a node inside the shadow root for this. The shell
 * takes it as a prop rather than reading the context, so it stays
 * presentational — and so this is checkable without mounting the provider tree.
 */
function panel(props: Partial<Parameters<typeof UtilityPanel>[0]> = {}) {
  return (
    <UtilityPanel
      breakpoint="desktop"
      activity={[]}
      onNewPage={() => undefined}
      onUploadMedia={() => undefined}
      onClose={() => undefined}
      onSelectActivity={() => undefined}
      pendingChanges={3}
      discardAllDescription="All 3 unpublished changes in this project go away. This cannot be undone."
      {...props}
    />
  );
}

describe("Discard all in the quick actions", () => {
  test("is not offered when there is nothing to discard", () => {
    render(panel({ onDiscardAll: () => undefined, pendingChanges: 0 }));
    expect(screen.queryByText(/Discard 0/)).toBeNull();
  });

  test("is not offered when the mode cannot discard", () => {
    // A disabled row would raise a question it cannot answer.
    render(panel({ onDiscardAll: undefined }));
    expect(screen.queryByText(/Discard 3/)).toBeNull();
  });

  test("does not discard on the first click — it asks", () => {
    let discarded = 0;
    render(panel({ onDiscardAll: () => discarded++ }));
    fireEvent.click(screen.getByText("Discard 3 changes"));
    expect(discarded).toBe(0);
    expect(screen.queryByText("Discard 3 changes?")).not.toBeNull();
  });

  test("renders the confirm INSIDE the container it was given", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    render(
      panel({ onDiscardAll: () => undefined, portalContainer: container }),
    );
    fireEvent.click(screen.getByText("Discard 3 changes"));
    // The whole bug in one assertion: without the container this content is a
    // child of `document.body` instead, where no Val stylesheet reaches it.
    expect(container.textContent).toContain("Discard 3 changes?");
    expect(container.textContent).toContain("cannot be undone");
    document.body.removeChild(container);
  });

  test("discards once confirmed", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    let discarded = 0;
    render(
      panel({ onDiscardAll: () => discarded++, portalContainer: container }),
    );
    fireEvent.click(screen.getByText("Discard 3 changes"));
    const confirm = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Discard 3",
    );
    if (confirm === undefined) throw new Error("no confirm button");
    fireEvent.click(confirm);
    expect(discarded).toBe(1);
    document.body.removeChild(container);
  });
});
