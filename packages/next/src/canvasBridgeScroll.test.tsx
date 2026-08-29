/**
 * @jest-environment jsdom
 */
import { act, render } from "@testing-library/react";
import {
  VAL_CANVAS_MESSAGE,
  type ValCanvasStudioMessage,
} from "@valbuild/shared/internal";
import { ValCanvasBridge } from "./ValCanvasBridge";

/**
 * The page is not allowed to scroll the studio.
 *
 * `Element.scrollIntoView` scrolls every scroll container between the element
 * and the viewport, and for a same-origin frame that chain does not stop at the
 * frame — it continues into the embedder. Measured in Chromium: with the
 * studio's phone panes placed on the editor, one `scrollIntoView` in the framed
 * page pulls them back onto the canvas, and because it reveals an ELEMENT rather
 * than a pane it can leave them anywhere in between.
 *
 * That is what turned "I tapped a field" into a workspace showing half the
 * editor and half the page. So this is checked at the boundary where the rule
 * can actually be stated: the page brings its own content into view by hand,
 * and never calls the one API that reaches out of the document.
 */
describe("the canvas bridge bringing a field into view", () => {
  let scrollIntoView: jest.Mock;
  let scrolledTo: ScrollToOptions[];

  beforeEach(() => {
    // Installed rather than spied on: jsdom does not implement
    // `scrollIntoView`, so there is nothing on the prototype to wrap — which
    // also means a call to it in the code under test would throw here rather
    // than being caught by an assertion, and this test would be about the wrong
    // thing.
    scrollIntoView = jest.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    scrolledTo = [];
    // The bridge re-measures the page whenever it could have moved; jsdom has
    // no layout for it to observe.
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    // jsdom has no scrolling of its own, and `window.scrollTo` is one of the
    // things it refuses outright rather than stubbing.
    window.scrollTo = ((options: ScrollToOptions) => {
      scrolledTo.push(options);
    }) as typeof window.scrollTo;
    jest
      .spyOn(window.parent, "postMessage")
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** The studio asking for a field to be outlined and shown. */
  const highlight = (path: string) => {
    const message: ValCanvasStudioMessage = {
      val: VAL_CANVAS_MESSAGE,
      type: "highlight",
      path: path as never,
      scrollIntoView: true,
    };
    act(() => {
      window.dispatchEvent(new MessageEvent("message", { data: message }));
    });
  };

  it("scrolls this document and never reaches out of the frame", () => {
    const path = '/content/page.val.ts?p="title"';
    render(
      <>
        <div data-val-path={path}>Title</div>
        <ValCanvasBridge draftMode />
      </>,
    );

    highlight(path);

    // `scrollIntoView` walks out of the frame and moves the studio's own
    // scrollers; the page brings its content into view by hand instead.
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(scrolledTo).toHaveLength(1);
  });

  it("does nothing at all for a path that is not on the page", () => {
    render(<ValCanvasBridge draftMode />);

    highlight('/content/page.val.ts?p="gone"');

    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(scrolledTo).toHaveLength(0);
  });
});
