/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { FloatingPanel } from "./FloatingPanel";

/**
 * A mobile bottom sheet has to have a HEIGHT when its child fills it.
 *
 * The sheet was sized by `maxHeight` alone, so its height came from its
 * content. That is right for a short list, and wrong for the assistant: the
 * chat is `h-full`, and a percentage height resting on an `auto` height
 * collapses. The transcript rendered about one message tall and then resized
 * on every token that streamed in — which is what "hard to see what is going
 * on" was.
 *
 * `maxHeight` is deliberately still the behaviour without `fill`, so the two
 * cases are pinned against each other rather than one being assumed.
 */

const VIEWPORT = 600;

beforeEach(() => {
  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    value: {
      height: VIEWPORT,
      offsetTop: 0,
      addEventListener() {},
      removeEventListener() {},
    },
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: VIEWPORT,
  });
});

function sheet(props: { fill?: boolean }) {
  return (
    <FloatingPanel
      side="right"
      width={420}
      title="AI assistant"
      mobileVariant="bottom-sheet"
      breakpoint="mobile"
      onClose={() => undefined}
      {...props}
    >
      <div>The assistant</div>
    </FloatingPanel>
  );
}

function panelEl(): HTMLElement {
  const el = screen.getByRole("dialog", { name: "AI assistant" });
  if (!(el instanceof HTMLElement)) throw new Error("expected an element");
  return el;
}

describe("a filled bottom sheet", () => {
  test("takes a definite height, not just a cap", () => {
    render(sheet({ fill: true }));
    const style = panelEl().style;
    expect(style.height).not.toBe("");
    // The cap would make the height content-driven again.
    expect(style.maxHeight).toBe("");
  });

  test("leaves the panel's own scroller off, so the child keeps its own", () => {
    render(sheet({ fill: true }));
    const body = panelEl().querySelector(".flex-1");
    expect(body?.className).toContain("overflow-hidden");
    expect(body?.className).not.toContain("overflow-y-auto");
  });

  test("without fill, a bottom sheet is still sized by its content", () => {
    render(sheet({}));
    const style = panelEl().style;
    expect(style.height).toBe("");
    expect(style.maxHeight).not.toBe("");
    const body = panelEl().querySelector(".flex-1");
    expect(body?.className).toContain("overflow-y-auto");
  });
});
