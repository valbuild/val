/**
 * @jest-environment jsdom
 */
import { act, render } from "@testing-library/react";
import {
  DEFAULT_CANVAS_SELECTION,
  DEFAULT_CANVAS_SELECTION_SOFT,
  VAL_CANVAS_MESSAGE,
  type ValCanvasPageMessage,
  type ValCanvasStudioMessage,
} from "@valbuild/shared/internal";
import { CanvasFrame } from "./CanvasFrame";

/**
 * Telling the page what colour to outline its content in.
 *
 * Everything else a project's accent touches follows by cascade: the studio
 * overrides the brand ramp as custom properties, and the stylesheet re-derives
 * its tokens from them. The canvas is where that stops working, because the
 * outlines are drawn **inside the customer's own document**, which has none of
 * Val's stylesheet — the tokens are not overridden there, they do not exist.
 *
 * So the colour is sent. This is the studio's half of that: it pushes the
 * colours the way it pushes picking, rather than setting them on the frame,
 * because only the page can apply them.
 *
 * The bug this was written for shipped: the outlines stayed Val green in a
 * violet studio, and every custom property in the world would not have moved
 * them.
 */
describe("the studio telling the page its accent", () => {
  let posted: ValCanvasStudioMessage[];
  let frame: HTMLIFrameElement;

  const VIOLET = {
    selection: "#8655f0",
    selectionSoft: "rgba(134, 85, 240, 0.4)",
  };

  const renderFrame = (
    selectionColors?: { selection: string; selectionSoft: string },
    reloadKey = 0,
  ) => {
    const rendered = render(
      <CanvasFrame
        url="/"
        width={800}
        height={600}
        reloadKey={reloadKey}
        isPicking
        highlightedPath={null}
        selectionColors={selectionColors}
        onRequestReload={() => {}}
      />,
    );
    const found = rendered.container.querySelector("iframe");
    if (found === null) throw new Error("the frame did not render");
    frame = found;
    const target = frame.contentWindow;
    if (target === null) throw new Error("the frame has no content window");
    posted = [];
    jest
      .spyOn(target, "postMessage")
      .mockImplementation((message: unknown) =>
        posted.push(message as ValCanvasStudioMessage),
      );
    return rendered;
  };

  const themes = () => posted.filter((message) => message.type === "theme");

  /**
   * A rerender with different colours.
   *
   * Every assertion here goes through one, and that is not a workaround: the
   * spy can only be installed once there is a frame to spy on, so a send made
   * during mount is unobservable — and in the real studio the accent arrives
   * with the settings, which is after mount anyway.
   */
  const withColors = (
    rendered: ReturnType<typeof render>,
    selectionColors?: { selection: string; selectionSoft: string },
    reloadKey = 0,
  ) =>
    rendered.rerender(
      <CanvasFrame
        url="/"
        width={800}
        height={600}
        reloadKey={reloadKey}
        isPicking
        highlightedPath={null}
        selectionColors={selectionColors}
        onRequestReload={() => {}}
      />,
    );

  /** The page announcing itself, which is what a new document does. */
  const reportReady = () => {
    const message: ValCanvasPageMessage = {
      val: VAL_CANVAS_MESSAGE,
      type: "ready",
      draftMode: true,
      url: "/",
    };
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: frame.contentWindow,
          data: message,
        }),
      );
    });
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("sends the accent when the project has one", () => {
    const rendered = renderFrame();
    withColors(rendered, VIOLET);
    expect(themes().at(-1)).toEqual({
      val: VAL_CANVAS_MESSAGE,
      type: "theme",
      ...VIOLET,
    });
  });

  it("sends Val's green back when the accent is cleared", () => {
    // Clearing an accent is as much a change as setting one: a document that
    // was told violet has to be told when violet no longer applies, or the
    // page keeps outlining in a colour the project has stopped using.
    const rendered = renderFrame(VIOLET);
    withColors(rendered, undefined);
    expect(themes().at(-1)).toEqual({
      val: VAL_CANVAS_MESSAGE,
      type: "theme",
      selection: DEFAULT_CANVAS_SELECTION,
      selectionSoft: DEFAULT_CANVAS_SELECTION_SOFT,
    });
  });

  it("tells a document that has just announced itself", () => {
    /*
     * A reload is a new page, and the bridge in it starts at Val's green
     * knowing nothing — so the colour has to be re-sent rather than assumed to
     * have survived. `ready` is how the studio learns a new document exists,
     * which is why the effect is keyed on the frame's status and not only on
     * the colours.
     *
     * Driven through `ready` rather than by bumping `reloadKey`: that prop is
     * part of the iframe's `key`, so changing it gives a whole new
     * `contentWindow` and the spy would be watching a window nothing posts to
     * any more. The transition under test is the same one either way.
     */
    const rendered = renderFrame(VIOLET);
    void rendered;
    reportReady();
    expect(themes().at(-1)).toEqual({
      val: VAL_CANVAS_MESSAGE,
      type: "theme",
      ...VIOLET,
    });
  });
});
