/**
 * @jest-environment jsdom
 */
import { act, render } from "@testing-library/react";
import {
  DEFAULT_CANVAS_SELECTION,
  DEFAULT_CANVAS_SELECTION_SOFT,
  VAL_CANVAS_MESSAGE,
  type ValCanvasStudioMessage,
} from "@valbuild/shared/internal";
import { ValCanvasBridge } from "./ValCanvasBridge";

/**
 * The page's half of following the project's accent.
 *
 * The bridge runs inside the customer's own document, which has none of Val's
 * stylesheet — so the outlines it draws cannot be a custom property, and a
 * project that sets `theme.accent` cannot reach them by cascade. The colour
 * arrives over the canvas protocol instead, and this is the end that applies
 * it.
 *
 * Both directions of version skew have to survive, because the studio and the
 * app are separately deployed: an app on an older `@valbuild/next` than its
 * studio ignores a message it does not recognise, and a newer app talking to an
 * older studio is simply never told. Both keep outlining, in Val's green.
 */
describe("the canvas bridge taking its colours from the studio", () => {
  beforeEach(() => {
    // The bridge re-measures whenever the page could have moved; jsdom has no
    // layout for it to observe.
    Reflect.set(
      globalThis,
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    jest
      .spyOn(window.parent, "postMessage")
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    Reflect.deleteProperty(globalThis, "ResizeObserver");
  });

  const send = (message: ValCanvasStudioMessage) => {
    act(() => {
      window.dispatchEvent(new MessageEvent("message", { data: message }));
    });
  };

  /** Picking is what draws the resting outlines at all. */
  const startPicking = () =>
    send({ val: VAL_CANVAS_MESSAGE, type: "setPicking", picking: true });

  const injectedCss = (container: HTMLElement) =>
    Array.from(container.querySelectorAll("style"))
      .map((style) => style.innerHTML)
      .join("\n");

  it("outlines in Val's green until it is told otherwise", () => {
    // The state every page starts in, and the one an older studio leaves it
    // in for good.
    const { container } = render(<ValCanvasBridge draftMode />);
    startPicking();
    const css = injectedCss(container);
    expect(css).toContain(DEFAULT_CANVAS_SELECTION_SOFT);
    expect(css).toContain(DEFAULT_CANVAS_SELECTION);
  });

  it("outlines in the accent once the studio sends it", () => {
    const { container } = render(<ValCanvasBridge draftMode />);
    startPicking();
    send({
      val: VAL_CANVAS_MESSAGE,
      type: "theme",
      selection: "#8655f0",
      selectionSoft: "rgba(134, 85, 240, 0.4)",
    });
    const css = injectedCss(container);
    expect(css).toContain("rgba(134, 85, 240, 0.4)");
    expect(css).toContain("#8655f0");
    // And Val's green is gone rather than left in a rule underneath.
    expect(css).not.toContain(DEFAULT_CANVAS_SELECTION_SOFT);
    expect(css).not.toContain(DEFAULT_CANVAS_SELECTION);
  });

  it("uses the accent for a highlighted field too", () => {
    // A highlight is a different rule, built by a different function, and it
    // had its own copy of the colour.
    const path = '/content/page.val.ts?p="title"';
    const { container } = render(
      <>
        <div data-val-path={path}>Title</div>
        <ValCanvasBridge draftMode />
      </>,
    );
    send({
      val: VAL_CANVAS_MESSAGE,
      type: "theme",
      selection: "#8655f0",
      selectionSoft: "rgba(134, 85, 240, 0.4)",
    });
    send({
      val: VAL_CANVAS_MESSAGE,
      type: "highlight",
      path: path as never,
    });
    const css = injectedCss(container);
    expect(css).toContain("#8655f0");
    expect(css).not.toContain(DEFAULT_CANVAS_SELECTION);
  });

  it("goes back to Val's green when the accent is cleared", () => {
    const { container } = render(<ValCanvasBridge draftMode />);
    startPicking();
    send({
      val: VAL_CANVAS_MESSAGE,
      type: "theme",
      selection: "#8655f0",
      selectionSoft: "rgba(134, 85, 240, 0.4)",
    });
    send({
      val: VAL_CANVAS_MESSAGE,
      type: "theme",
      selection: DEFAULT_CANVAS_SELECTION,
      selectionSoft: DEFAULT_CANVAS_SELECTION_SOFT,
    });
    expect(injectedCss(container)).toContain(DEFAULT_CANVAS_SELECTION);
  });
});
