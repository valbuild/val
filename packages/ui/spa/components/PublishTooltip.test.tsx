/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { PublishTooltip } from "./PublishTooltip";
import { TooltipProvider } from "./designSystem/tooltip";

/**
 * The Save button is the same DOM node whether it is pressable or not.
 *
 * It was not: the tooltip wrapped it only while disabled, so every flip
 * remounted it, and a press that straddled a flip -- down on the old node, up
 * on the new one -- was no click. With changes already pending, Save is
 * enabled, and pressing it as the last edit reached the server did nothing and
 * said nothing.
 */
function face(disabled: boolean) {
  return (
    <TooltipProvider>
      <PublishTooltip
        label="Save to disk"
        description="Save to disk"
        disabled={disabled}
        container={null}
      >
        <button disabled={disabled}>Save</button>
      </PublishTooltip>
    </TooltipProvider>
  );
}

test("flipping disabled keeps the button, rather than mounting a new one", () => {
  const { rerender } = render(face(false));
  const before = screen.getByText("Save");
  rerender(face(true));
  expect(screen.getByText("Save")).toBe(before);
  rerender(face(false));
  expect(screen.getByText("Save")).toBe(before);
});

test("disabled, the wrapper is what a tooltip and a screen reader reach", () => {
  render(face(true));
  const wrapper = screen.getByRole("button", { name: "Save to disk" });
  expect(wrapper.getAttribute("aria-disabled")).toBe("true");
});

test("enabled, the button itself is what is reached", () => {
  render(face(false));
  expect(screen.getByRole("button", { name: "Save" })).toBe(
    screen.getByText("Save"),
  );
});
