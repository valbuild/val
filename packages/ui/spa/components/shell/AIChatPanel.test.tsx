/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { AIChatPanel } from "./AIChatPanel";

/**
 * The assistant panel's one decision: dismissed is not the same as gone.
 *
 * Every other panel unmounts when it closes, and should. This one cannot: it
 * holds the conversation, the composer draft and — while a turn is running —
 * the only thing that can answer the model's tool calls. The scrim covers the
 * whole viewport, so "closing" it is one stray click in the editor away, and
 * unmounting on that killed the turn with no error anywhere.
 *
 * So both halves are checked: the contents survive being hidden, and a hidden
 * panel is not still listening for the gestures that dismiss it.
 */
function panel(props: Partial<Parameters<typeof AIChatPanel>[0]> = {}) {
  return (
    <AIChatPanel
      breakpoint="desktop"
      hidden={false}
      onClose={() => undefined}
      {...props}
    >
      <div>The assistant</div>
    </AIChatPanel>
  );
}

describe("AIChatPanel", () => {
  test("shows the assistant when it is open", () => {
    render(panel());
    expect(screen.queryByText("The assistant")).not.toBeNull();
  });

  test("keeps the assistant mounted when it is dismissed", () => {
    render(panel({ hidden: true }));
    // In the DOM, so its state — and any turn it is in the middle of — is
    // still there. `display: none` is what takes it off the screen.
    expect(screen.queryByText("The assistant")).not.toBeNull();
  });

  test("closes on Escape while open, and ignores it once dismissed", () => {
    let closes = 0;
    const onClose = () => {
      closes++;
    };
    const { rerender } = render(panel({ onClose }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(closes).toBe(1);

    rerender(panel({ onClose, hidden: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    // A dismissed panel that still answered Escape would be reporting a close
    // for something that is already closed, on every press.
    expect(closes).toBe(1);
  });
});
