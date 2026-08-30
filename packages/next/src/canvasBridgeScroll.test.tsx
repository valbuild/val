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
  /**
   * What was on the globals before this suite replaced them.
   *
   * Three of these are assigned rather than spied on, so `restoreAllMocks` does
   * not know about them — and the one that matters most is `scrollIntoView`:
   * left installed, a later suite would find a mock where jsdom has nothing,
   * and an accidental call to it would be swallowed instead of throwing. A test
   * that hides the very thing this file exists to catch is worse than no test.
   *
   * Two of the three are ABSENT in jsdom rather than merely different, so
   * restoring them means removing them again. Hence `Reflect` and `unknown`:
   * "there was nothing here" is a value this has to be able to carry, and
   * neither the global's own type nor an assertion can say it.
   */
  const originals: { owner: object; key: string; value: unknown }[] = [];
  const replace = (owner: object, key: string, value: unknown) => {
    originals.push({
      owner,
      key,
      value: key in owner ? Reflect.get(owner, key) : undefined,
    });
    Reflect.set(owner, key, value);
  };

  beforeEach(() => {
    // Installed rather than spied on: jsdom does not implement
    // `scrollIntoView`, so there is nothing on the prototype to wrap — which
    // also means a call to it in the code under test would throw here rather
    // than being caught by an assertion, and this test would be about the wrong
    // thing.
    scrollIntoView = jest.fn();
    replace(Element.prototype, "scrollIntoView", scrollIntoView);
    scrolledTo = [];
    // The bridge re-measures the page whenever it could have moved; jsdom has
    // no layout for it to observe.
    replace(
      globalThis,
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    // jsdom has no scrolling of its own, and `window.scrollTo` is one of the
    // things it refuses outright rather than stubbing.
    replace(window, "scrollTo", (options: ScrollToOptions) => {
      scrolledTo.push(options);
    });
    jest
      .spyOn(window.parent, "postMessage")
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    // And the three the mock registry knows nothing about. See `originals`.
    for (const { owner, key, value } of originals.reverse()) {
      if (value === undefined) Reflect.deleteProperty(owner, key);
      else Reflect.set(owner, key, value);
    }
    originals.length = 0;
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
