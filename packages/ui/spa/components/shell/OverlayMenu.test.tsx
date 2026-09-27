/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { OverlayMenuLauncher } from "./OverlayMenu";

/**
 * `holdOpen`: the overlay menu stays expanded while something opened from it
 * — the commit message popover, portalled outside the menu — is in use.
 *
 * Without it, moving the pointer onto that popover was a mouse-leave and a
 * press in it an outside press, and either collapsed the menu under the
 * popover's anchor.
 */

function Launcher({ holdOpen }: { holdOpen: boolean }) {
  return (
    <>
      <OverlayMenuLauncher
        orientation="horizontal"
        dock="right-bottom"
        mark={<span>V</span>}
        holdOpen={holdOpen}
      >
        <button type="button">Publish</button>
      </OverlayMenuLauncher>
      {/* Stands in for a popover portalled outside the menu. */}
      <button type="button">Outside</button>
    </>
  );
}

function menuToggle() {
  return screen.getByRole("button", { name: /Val menu/ });
}

function root() {
  // The element that owns hover: the launcher's outermost node.
  const toolbar = screen.getByRole("toolbar");
  const parent = toolbar.parentElement;
  if (parent === null) throw new Error("the toolbar has no launcher around it");
  return parent;
}

describe("OverlayMenuLauncher holdOpen", () => {
  test("without it, leaving the menu collapses a hovered menu", () => {
    render(<Launcher holdOpen={false} />);
    fireEvent.mouseEnter(root());
    expect(menuToggle().getAttribute("aria-expanded")).toBe("true");
    fireEvent.mouseLeave(root());
    expect(menuToggle().getAttribute("aria-expanded")).toBe("false");
  });

  test("while held, leaving, pressing outside and Escape keep it open", () => {
    render(<Launcher holdOpen />);
    expect(menuToggle().getAttribute("aria-expanded")).toBe("true");
    fireEvent.mouseLeave(root());
    fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(menuToggle().getAttribute("aria-expanded")).toBe("true");
  });

  test("when the hold ends, it is as open as the pointer says", () => {
    const { rerender } = render(<Launcher holdOpen={false} />);
    fireEvent.mouseEnter(root());
    rerender(<Launcher holdOpen />);
    // The pointer moves onto the popover, outside the menu.
    fireEvent.mouseLeave(root());
    expect(menuToggle().getAttribute("aria-expanded")).toBe("true");
    rerender(<Launcher holdOpen={false} />);
    expect(menuToggle().getAttribute("aria-expanded")).toBe("false");
  });
});
