/**
 * @jest-environment jsdom
 */
import { act, render } from "@testing-library/react";
import {
  VAL_CANVAS_MESSAGE,
  type ValCanvasPageMessage,
  type ValCanvasStudioMessage,
} from "@valbuild/shared/internal";
import {
  ANSWER_TIMEOUT_MS,
  CanvasFrame,
  SWAP_PAINT_MAX_MS,
  SWAP_PAINT_MS,
} from "./CanvasFrame";
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

/**
 * A swap used to be a blank frame: the `<iframe>` was replaced, so the page
 * was gone -- white -- from the moment a build or a quick preview was ready
 * until its document had loaded and rendered. In code mode that was once a
 * write. Now the document being replaced stays on screen, over the one
 * loading under it, until that one says it is there.
 */
describe("a swap never shows a blank frame", () => {
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
  const frames = (container: HTMLElement) =>
    Array.from(container.querySelectorAll("iframe"));
  const leaving = (container: HTMLElement) =>
    container.querySelector("iframe[data-val-canvas-leaving]");
  /**
   * The document the frame loaded, with nothing drawn in it yet: jsdom
   * loads nothing, so a frame's document has no `<body>` until it is given
   * one.
   */
  const load = (frame: HTMLIFrameElement): HTMLElement => {
    const page = frame.contentDocument;
    if (page === null) throw new Error("the frame has no document");
    if (page.body !== null) return page.body;
    const html =
      page.documentElement ?? page.appendChild(page.createElement("html"));
    return html.appendChild(page.createElement("body"));
  };
  /** The page in `frame` renders: its app's script first, then its markup. */
  const draw = (frame: HTMLIFrameElement) => {
    const page = load(frame).ownerDocument;
    load(frame).append(
      page.createElement("script"),
      page.createElement("main"),
    );
  };

  function mount(
    props: {
      quickPreviewId?: string | null;
      documentKey?: number;
      reloadKey?: number;
      url?: string;
    } = {},
  ) {
    const statuses: string[] = [];
    const onStatusChange = (status: string) => statuses.push(status);
    const canvas = (next: typeof props) => (
      <CanvasFrame
        url={next.url ?? "/"}
        width={800}
        height={600}
        reloadKey={next.reloadKey ?? 0}
        isPicking={false}
        highlightedPath={null}
        documentKey={next.documentKey ?? 0}
        quickPreviewId={next.quickPreviewId ?? null}
        onStatusChange={onStatusChange}
      />
    );
    const rendered = render(canvas(props));
    /*
     * Every frame the canvas loads, and every frame taken out of it. A frame
     * that is taken out and put back -- moved -- loads its page again, so it
     * would be in both.
     */
    const loaded: HTMLIFrameElement[] = [...frames(rendered.container)];
    const removed: Node[] = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of Array.from(record.addedNodes)) {
          if (node instanceof HTMLIFrameElement) loaded.push(node);
        }
        removed.push(...Array.from(record.removedNodes));
      }
    });
    observer.observe(rendered.container, { childList: true, subtree: true });
    return {
      ...rendered,
      statuses,
      loaded,
      removed,
      swapTo: (next: typeof props) => rendered.rerender(canvas(next)),
      flush: () => observer.takeRecords(),
    };
  }

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test("the page being replaced stays on screen until the new one says it is there, and the frame loads once", async () => {
    const canvas = mount();
    const old = frames(canvas.container)[0];
    say(old, ready);
    expect(canvas.statuses.at(-1)).toBe("live");

    canvas.swapTo({ quickPreviewId: "q1" });
    await act(async () => {});
    // Two frames: the new document, and the old one over it, untouched.
    const [next, kept] = frames(canvas.container);
    expect(next.getAttribute("src")).toBe("/?val_quick=q1&val_canvas=1");
    expect(kept).toBe(old);
    expect(kept.getAttribute("src")).toBe("/?val_canvas=1");
    expect(leaving(canvas.container)).toBe(old);
    expect(canvas.removed).not.toContain(old);
    // Nothing is said of it: the page on screen is the last one that worked.
    expect(canvas.statuses.at(-1)).toBe("swapping");
    expect(canvas.statuses).toEqual(["connecting", "live", "swapping"]);

    // However long the new document takes, the old one is what is shown.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(3_000);
    });
    expect(leaving(canvas.container)).toBe(old);

    load(next);
    say(next, ready);
    expect(canvas.statuses.at(-1)).toBe("live");
    // It is there, with nothing drawn yet -- a quick preview renders in the
    // browser, after its bridge has spoken: the old document stays.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(SWAP_PAINT_MS * 10);
    });
    expect(leaving(canvas.container)).toBe(old);
    // Something on the page, and the old document goes.
    draw(next);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(SWAP_PAINT_MS);
    });
    expect(frames(canvas.container)).toEqual([next]);
    // One quick preview shown is one frame loaded: the one it was shown in.
    expect(canvas.loaded).toEqual([old, next]);
  });

  test("a second swap before the first is there keeps the last page anyone saw", async () => {
    const canvas = mount();
    const old = frames(canvas.container)[0];
    say(old, ready);
    canvas.swapTo({ quickPreviewId: "q1" });
    await act(async () => {});
    canvas.swapTo({ quickPreviewId: "q2" });
    await act(async () => {});
    const [next, kept] = frames(canvas.container);
    expect(frames(canvas.container)).toHaveLength(2);
    expect(next.getAttribute("src")).toBe("/?val_quick=q2&val_canvas=1");
    expect(kept).toBe(old);
    say(next, ready);
    draw(next);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(SWAP_PAINT_MS);
    });
    expect(frames(canvas.container)).toEqual([next]);
  });

  test("a page that is there and stays empty is shown as it is, in the end", async () => {
    const canvas = mount();
    const old = frames(canvas.container)[0];
    say(old, ready);
    canvas.swapTo({ documentKey: 1 });
    await act(async () => {});
    const next = frames(canvas.container)[0];
    load(next);
    say(next, ready);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(SWAP_PAINT_MAX_MS - SWAP_PAINT_MS);
    });
    expect(leaving(canvas.container)).toBe(old);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(SWAP_PAINT_MS);
    });
    expect(frames(canvas.container)).toEqual([next]);
  });

  test("a swap back to the document being replaced is a new frame too, not the old one handed back", async () => {
    const canvas = mount();
    const old = frames(canvas.container)[0];
    say(old, ready);
    canvas.swapTo({ quickPreviewId: "q1" });
    await act(async () => {});
    // Back to the served build before the quick preview came up: the same
    // address the old frame holds, which already said `ready` long ago.
    canvas.swapTo({ quickPreviewId: null });
    await act(async () => {});
    const [next, kept] = frames(canvas.container);
    expect(frames(canvas.container)).toHaveLength(2);
    expect(kept).toBe(old);
    expect(next).not.toBe(old);
    expect(next.getAttribute("src")).toBe("/?val_canvas=1");
    // So it answers, and the canvas is live again.
    say(next, ready);
    expect(canvas.statuses.at(-1)).toBe("live");
  });

  test("a new document that never answers does not leave the old page up as if it were current", async () => {
    const canvas = mount();
    const old = frames(canvas.container)[0];
    say(old, ready);
    canvas.swapTo({ documentKey: 1 });
    await act(async () => {});
    expect(leaving(canvas.container)).toBe(old);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(ANSWER_TIMEOUT_MS);
    });
    expect(leaving(canvas.container)).toBeNull();
    expect(canvas.statuses.at(-1)).toBe("no-answer");
  });

  test("a reload the person asked for, and another page, load in the open", async () => {
    const canvas = mount();
    const old = frames(canvas.container)[0];
    say(old, ready);
    canvas.swapTo({ reloadKey: 1 });
    await act(async () => {});
    expect(frames(canvas.container)).toHaveLength(1);
    expect(canvas.statuses.at(-1)).toBe("connecting");

    say(frames(canvas.container)[0], ready);
    canvas.swapTo({ reloadKey: 1, url: "/blog" });
    await act(async () => {});
    expect(frames(canvas.container)).toHaveLength(1);
    expect(leaving(canvas.container)).toBeNull();
  });

  test("a page that never answered is not kept: there is nothing of it worth looking at", async () => {
    const canvas = mount();
    canvas.swapTo({ quickPreviewId: "q1" });
    await act(async () => {});
    expect(frames(canvas.container)).toHaveLength(1);
  });
});
