/**
 * @jest-environment jsdom
 */
import { act, render } from "@testing-library/react";
import {
  VAL_CANVAS_MESSAGE,
  type ValCanvasPageMessage,
  type ValCanvasStudioMessage,
} from "@valbuild/shared/internal";
import { CanvasFrame } from "./CanvasFrame";
import { withQuickPreview } from "./canvasSwap";

/**
 * A new document in the canvas -- a build served, someone else's change as a
 * quick preview -- while someone is using the page.
 *
 * Swapping it in at once reloads the page under their hands: what they typed
 * is gone, and so is where they were. So it waits while the page has the
 * focus, and comes in once they leave it, at the path and scroll the page
 * last said it was at.
 */
describe("a new document while the page is in use", () => {
  let posted: ValCanvasStudioMessage[];

  function frameOf(container: HTMLElement): HTMLIFrameElement {
    const frame = container.querySelector("iframe");
    if (frame === null) throw new Error("the frame did not render");
    return frame;
  }

  function listen(frame: HTMLIFrameElement) {
    const target = frame.contentWindow;
    if (target === null) throw new Error("the frame has no content window");
    jest
      .spyOn(target, "postMessage")
      .mockImplementation((message: unknown) =>
        posted.push(message as ValCanvasStudioMessage),
      );
  }

  function say(frame: HTMLIFrameElement, message: ValCanvasPageMessage) {
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: frame.contentWindow,
          data: message,
        }),
      );
    });
  }

  const ready: ValCanvasPageMessage = {
    val: VAL_CANVAS_MESSAGE,
    type: "ready",
    draftMode: true,
    url: "/",
  };
  const scrolledTo: ValCanvasPageMessage = {
    val: VAL_CANVAS_MESSAGE,
    type: "location",
    path: "/blog?tag=news",
    scrollX: 0,
    scrollY: 640,
  };

  beforeEach(() => {
    posted = [];
  });

  function Canvas(props: {
    documentKey: number;
    quickPreviewId?: string | null;
    onDocument?: (document: { quick: string | null }) => void;
  }) {
    return (
      <>
        <button type="button">Somewhere in the Studio</button>
        <CanvasFrame
          url="/"
          width={800}
          height={600}
          reloadKey={0}
          isPicking={false}
          highlightedPath={null}
          {...props}
        />
      </>
    );
  }

  test("waits while the page has the focus, then comes in where the page was", () => {
    const rendered = render(<Canvas documentKey={0} />);
    const before = frameOf(rendered.container);
    listen(before);
    say(before, ready);
    say(before, scrolledTo);

    // Someone is typing in the page
    act(() => before.focus());
    expect(document.activeElement).toBe(before);
    rendered.rerender(<Canvas documentKey={1} />);
    expect(frameOf(rendered.container)).toBe(before);

    // They go back to the Studio: the new document comes in where they were
    act(() => rendered.getByRole("button").focus());
    const after = frameOf(rendered.container);
    expect(after).not.toBe(before);
    expect(after.getAttribute("src")).toBe("/blog?tag=news&val_canvas=1");
    listen(after);
    say(after, ready);
    expect(posted).toContainEqual({
      val: VAL_CANVAS_MESSAGE,
      type: "scrollTo",
      x: 0,
      y: 640,
    });
  });

  test("comes in at once when nobody is using the page", () => {
    const rendered = render(<Canvas documentKey={0} />);
    const before = frameOf(rendered.container);
    rendered.rerender(<Canvas documentKey={1} />);
    expect(frameOf(rendered.container)).not.toBe(before);
  });

  test("a quick preview is opened as one, and the page says which it is once it loads", () => {
    const shown: (string | null)[] = [];
    const onDocument = (document: { quick: string | null }) =>
      shown.push(document.quick);
    const rendered = render(
      <Canvas documentKey={0} quickPreviewId={null} onDocument={onDocument} />,
    );
    const before = frameOf(rendered.container);
    say(before, ready);
    expect(shown).toEqual([null]);

    act(() => before.focus());
    rendered.rerender(
      <Canvas documentKey={0} quickPreviewId="q1" onDocument={onDocument} />,
    );
    // Held: the page that loads meanwhile is still the served build
    say(frameOf(rendered.container), ready);
    expect(shown).toEqual([null, null]);

    act(() => rendered.getByRole("button").focus());
    const quick = frameOf(rendered.container);
    expect(quick.getAttribute("src")).toBe("/?val_quick=q1&val_canvas=1");
    say(quick, ready);
    expect(shown).toEqual([null, null, "q1"]);
  });
});

describe("withQuickPreview", () => {
  test("opens the page as the quick preview, keeping its query and hash", () => {
    expect(withQuickPreview("/blog", "abc")).toBe("/blog?val_quick=abc");
    expect(withQuickPreview("/blog?x=1#top", "abc")).toBe(
      "/blog?x=1&val_quick=abc#top",
    );
    expect(withQuickPreview("/blog", null)).toBe("/blog");
  });
});

describe("a page the Studio asks for after a swap", () => {
  test("opens where it says, in one navigation", () => {
    const ready: ValCanvasPageMessage = {
      val: VAL_CANVAS_MESSAGE,
      type: "ready",
      draftMode: true,
      url: "/",
    };
    const say = (frame: HTMLIFrameElement, message: ValCanvasPageMessage) =>
      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            source: frame.contentWindow,
            data: message,
          }),
        );
      });
    const canvas = (url: string, documentKey: number) => (
      <CanvasFrame
        url={url}
        width={800}
        height={600}
        reloadKey={0}
        isPicking={false}
        highlightedPath={null}
        documentKey={documentKey}
      />
    );
    const rendered = render(canvas("/", 0));
    const first = rendered.container.querySelector("iframe")!;
    say(first, ready);
    say(first, {
      val: VAL_CANVAS_MESSAGE,
      type: "location",
      path: "/blog",
      scrollX: 0,
      scrollY: 100,
    });
    // A new build, swapped in where the page was
    rendered.rerender(canvas("/", 1));
    expect(
      rendered.container.querySelector("iframe")!.getAttribute("src"),
    ).toBe("/blog?val_canvas=1");
    // The Studio opens another page: that page, never the swapped-in one
    const sources: (string | null)[] = [];
    const observer = new MutationObserver(() =>
      sources.push(
        rendered.container.querySelector("iframe")?.getAttribute("src") ?? null,
      ),
    );
    observer.observe(rendered.container, {
      subtree: true,
      childList: true,
      attributes: true,
    });
    rendered.rerender(canvas("/about", 1));
    observer.disconnect();
    expect(
      rendered.container.querySelector("iframe")!.getAttribute("src"),
    ).toBe("/about?val_canvas=1");
    expect(sources.every((src) => src === "/about?val_canvas=1")).toBe(true);
  });
});
