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

  const tell = (message: ValCanvasStudioMessage) =>
    act(() => {
      window.dispatchEvent(new MessageEvent("message", { data: message }));
    });

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

  it("answers readPage with what is on the page", () => {
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
    const reply = posted.find((message) => message.type === "pageRead");
    expect(reply).toMatchObject({
      requestId: "r1",
      snapshot: { element: { tag: "h1", text: "Our people" } },
    });
  });
});
