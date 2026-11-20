/**
 * @jest-environment jsdom
 */
import { act, render, waitFor } from "@testing-library/react";
import {
  BRIDGE_CAPABILITIES,
  type CanvasRequest,
  pageLogOf,
  VAL_CANVAS_MESSAGE,
  type ValCanvasPageMessage,
  type ValCanvasStudioMessage,
} from "@valbuild/shared/internal";
import { ValCanvasBridge } from "./ValCanvasBridge";

/**
 * The Studio looking at the page: where it is (so a new build opens at
 * the same place), scrolling it there, and what is on it (`read_page`).
 */
describe("the canvas bridge, looked at from the Studio", () => {
  let posted: ValCanvasPageMessage[];

  beforeEach(() => {
    posted = [];
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
      .mockImplementation((message: unknown) => {
        posted.push(message as ValCanvasPageMessage);
      });
  });

  afterEach(() => {
    // The log is the window's, and outlives a render: one per test.
    pageLogOf(window)?.uninstall();
    jest.restoreAllMocks();
    Reflect.deleteProperty(globalThis, "ResizeObserver");
  });

  /** From the frame's parent -- the Studio here, at this page's origin -- or from elsewhere. */
  const tell = (
    message: ValCanvasStudioMessage,
    from: { source: Window | null; origin: string } = {
      source: window.parent,
      origin: window.location.origin,
    },
  ) =>
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: message,
          source: from.source,
          origin: from.origin,
        }),
      );
    });
  const settle = () =>
    act(() => new Promise((resolve) => setTimeout(resolve, 0)));

  it("says where the page is", () => {
    window.history.replaceState(null, "", "/about?val_canvas=1");
    render(<ValCanvasBridge draftMode />);
    expect(posted).toContainEqual({
      val: VAL_CANVAS_MESSAGE,
      type: "location",
      path: "/about",
      scrollX: 0,
      scrollY: 0,
    });
  });

  it("scrolls to where it is told", () => {
    const scrollTo = jest
      .spyOn(window, "scrollTo")
      .mockImplementation(() => {});
    render(<ValCanvasBridge draftMode />);
    tell({ val: VAL_CANVAS_MESSAGE, type: "scrollTo", x: 0, y: 640 });
    expect(scrollTo).toHaveBeenCalledWith(0, 640);
  });

  it("answers readPage with what is on the page", async () => {
    render(
      <main>
        <h1>Our people</h1>
        <p>Twelve of us.</p>
        <ValCanvasBridge draftMode />
      </main>,
    );
    tell({
      val: VAL_CANVAS_MESSAGE,
      type: "readPage",
      requestId: "r1",
      selector: "div > main > h1",
    });
    await settle();
    const reply = posted.find((message) => message.type === "pageRead");
    expect(reply).toMatchObject({
      requestId: "r1",
      snapshot: { element: { tag: "h1", text: "Our people" } },
    });
  });

  it("tells what is on the page to nobody but its parent", async () => {
    render(
      <main>
        <p>Unpublished words</p>
        <ValCanvasBridge draftMode />
      </main>,
    );
    // Another window holding a handle on this one.
    tell(
      { val: VAL_CANVAS_MESSAGE, type: "readPage", requestId: "r2" },
      { source: null, origin: "https://elsewhere.example" },
    );
    await settle();
    expect(posted.some((message) => message.type === "pageRead")).toBe(false);
  });

  it("says in ready what it answers, and which package it is", () => {
    render(<ValCanvasBridge draftMode />);
    const ready = posted.find((message) => message.type === "ready");
    expect(ready).toMatchObject({
      capabilities: [...BRIDGE_CAPABILITIES],
      bridge: { package: "@valbuild/next" },
    });
  });

  it("answers every request it says it answers", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    render(<ValCanvasBridge draftMode />);
    // Each request, and the message that answers it -- with what was asked
    // or with why not (jsdom can draw no picture and has no service worker),
    // but answered: the Studio waits for nothing a bridge does not list.
    const asks: Record<
      CanvasRequest,
      { ask: ValCanvasStudioMessage; answer: ValCanvasPageMessage["type"] }
    > = {
      readPage: {
        ask: { val: VAL_CANVAS_MESSAGE, type: "readPage", requestId: "c1" },
        answer: "pageRead",
      },
      screenshotPage: {
        ask: {
          val: VAL_CANVAS_MESSAGE,
          type: "screenshotPage",
          requestId: "c2",
        },
        answer: "pageScreenshot",
      },
      readPageLog: {
        ask: { val: VAL_CANVAS_MESSAGE, type: "readPageLog", requestId: "c3" },
        answer: "pageLogRead",
      },
      quickPreview: {
        ask: {
          val: VAL_CANVAS_MESSAGE,
          type: "quickPreview",
          id: "q1",
          files: {},
        },
        answer: "quickPreviewStored",
      },
      editInline: {
        // Nothing offered, so nothing to edit: said, not left unanswered.
        ask: {
          val: VAL_CANVAS_MESSAGE,
          type: "editInline",
          requestId: "e1",
          candidates: [],
        },
        answer: "inlineEditUnavailable",
      },
    };
    for (const request of BRIDGE_CAPABILITIES) {
      tell(asks[request].ask);
      await waitFor(() =>
        expect(posted.map((message) => message.type)).toContain(
          asks[request].answer,
        ),
      );
    }
  });

  it("answers readPageLog with what went wrong on the page", async () => {
    const printed = jest.spyOn(console, "error").mockImplementation(() => {});
    render(<ValCanvasBridge draftMode />);
    console.error("Hero failed to render");
    // The page's own console still printed it.
    expect(printed).toHaveBeenCalledWith("Hero failed to render");
    tell({
      val: VAL_CANVAS_MESSAGE,
      type: "readPageLog",
      requestId: "l1",
      levels: ["error"],
    });
    await settle();
    const reply = posted.find((message) => message.type === "pageLogRead");
    expect(reply).toMatchObject({
      requestId: "l1",
      log: {
        entries: [
          {
            level: "error",
            source: "console",
            text: "Hero failed to render",
          },
        ],
      },
    });
  });

  it("tells what went wrong to nobody but its parent", async () => {
    render(<ValCanvasBridge draftMode />);
    tell(
      { val: VAL_CANVAS_MESSAGE, type: "readPageLog", requestId: "l2" },
      { source: null, origin: "https://elsewhere.example" },
    );
    await settle();
    expect(posted.some((message) => message.type === "pageLogRead")).toBe(
      false,
    );
  });

  it("counts what went wrong in every readPage answer", async () => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
    render(<ValCanvasBridge draftMode />);
    console.warn("Deprecated prop");
    tell({ val: VAL_CANVAS_MESSAGE, type: "readPage", requestId: "r3" });
    await settle();
    const reply = posted.find((message) => message.type === "pageRead");
    expect(reply).toMatchObject({
      snapshot: { log: { errors: 0, warnings: 1, failedRequests: 0 } },
    });
  });
});
