/**
 * @jest-environment jsdom
 */
import { act, render } from "@testing-library/react";
import {
  VAL_CANVAS_MESSAGE,
  type ValCanvasPageMessage,
  type ValCanvasStudioMessage,
} from "@valbuild/shared/internal";
import { ValCanvasBridge } from "./ValCanvasBridge";

/**
 * The design tab looking at the page: where it is (so a new build opens at
 * the same place), scrolling it there, and what is on it (`read_page`).
 */
describe("the canvas bridge, looked at from the design tab", () => {
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
});
