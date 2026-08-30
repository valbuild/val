/**
 * @jest-environment jsdom
 */
import { act, render } from "@testing-library/react";
import { SourcePath } from "@valbuild/core";
import {
  VAL_CANVAS_MESSAGE,
  type ValCanvasPageMessage,
  type ValCanvasStudioMessage,
} from "@valbuild/shared/internal";
import { CanvasFrame } from "./CanvasFrame";

/**
 * What the studio asks the page for after a pick.
 *
 * A pick is followed by a highlight of the field that was picked, and the
 * highlight used to carry `scrollIntoView: true` unconditionally — including for
 * the field the person had just put their finger on, which is by definition
 * already in front of them.
 *
 * Asking for it anyway was not merely redundant. The page's scroll does not stop
 * at the page: `scrollIntoView` inside a same-origin frame walks out of the
 * frame and scrolls the EMBEDDER's scroll containers too (measured in Chromium).
 * On a phone the embedder held the two panes, so the studio's answer to "I
 * picked this" was to switch to the fields column and then have the page drag it
 * back to the canvas — or, since what is being revealed is an element rather
 * than a pane, to somewhere between the two.
 *
 * `ValCanvasBridge` no longer calls `scrollIntoView` at all, and the phone's
 * panes are no longer a scroll offset for anything to move (`overflow-clip` in
 * `PageWorkspace`). This is the third of the three: do not ask for a scroll
 * there was never a reason to ask for.
 */
describe("a pick on the page", () => {
  let posted: ValCanvasStudioMessage[];
  let frame: HTMLIFrameElement;

  const PICKED = '/content/page.val.ts?p="title"' as SourcePath;
  const ELSEWHERE = '/content/page.val.ts?p="body"' as SourcePath;

  const renderFrame = (highlightedPath: SourcePath | null) => {
    const rendered = render(
      <CanvasFrame
        url="/"
        width={800}
        height={600}
        reloadKey={0}
        isPicking
        highlightedPath={highlightedPath}
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

  /** The page saying an element was clicked. */
  const click = (path: SourcePath) => {
    const message: ValCanvasPageMessage = {
      val: VAL_CANVAS_MESSAGE,
      type: "clicked",
      paths: [path],
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

  /** The last thing the studio asked the page to outline. */
  const lastHighlight = () =>
    posted.filter((message) => message.type === "highlight").at(-1);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("does not ask the page to scroll to the thing that was just clicked", () => {
    const rendered = renderFrame(null);
    click(PICKED);
    // The shell answers a pick by navigating, which comes back here as the
    // highlighted path.
    rendered.rerender(
      <CanvasFrame
        url="/"
        width={800}
        height={600}
        reloadKey={0}
        isPicking
        highlightedPath={PICKED}
        onRequestReload={() => {}}
      />,
    );

    expect(lastHighlight()).toEqual({
      val: VAL_CANVAS_MESSAGE,
      type: "highlight",
      path: PICKED,
      scrollIntoView: false,
    });
  });

  it("still asks for a field opened from anywhere else", () => {
    // A row in the fields column, a search hit, a validation error: the field is
    // not necessarily on screen, and finding it on the page is the whole point.
    const rendered = renderFrame(null);
    rendered.rerender(
      <CanvasFrame
        url="/"
        width={800}
        height={600}
        reloadKey={0}
        isPicking
        highlightedPath={ELSEWHERE}
        onRequestReload={() => {}}
      />,
    );
    expect(lastHighlight()).toEqual({
      val: VAL_CANVAS_MESSAGE,
      type: "highlight",
      path: ELSEWHERE,
      scrollIntoView: true,
    });
  });

  it("asks again once the selection moves off the picked field", () => {
    const rendered = renderFrame(null);
    click(PICKED);
    rendered.rerender(
      <CanvasFrame
        url="/"
        width={800}
        height={600}
        reloadKey={0}
        isPicking
        highlightedPath={ELSEWHERE}
        onRequestReload={() => {}}
      />,
    );

    expect(lastHighlight()?.scrollIntoView).toBe(true);
  });

  it("asks again when the picked field is opened from the column later", () => {
    const rendered = renderFrame(null);
    const on = (path: SourcePath | null) =>
      rendered.rerender(
        <CanvasFrame
          url="/"
          width={800}
          height={600}
          reloadKey={0}
          isPicking
          highlightedPath={path}
          onRequestReload={() => {}}
        />,
      );
    click(PICKED);
    on(PICKED);
    on(ELSEWHERE);
    // Back to the same field, this time from a row in the fields column. The
    // finger is nowhere near it now, and where it is on the page is exactly what
    // is being asked.
    on(PICKED);

    expect(lastHighlight()?.scrollIntoView).toBe(true);
  });
});
