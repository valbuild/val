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
 * Picking ANY element for the design tab: the studio asks with
 * `pickElements`, the page picks with its own elements (which only it can
 * reach), and what crosses back is the element described.
 */
describe("the canvas bridge picking any element", () => {
  let posted: unknown[];

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
        posted.push(message);
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
  const pickElements = (
    over: Partial<Extract<ValCanvasStudioMessage, { type: "pickElements" }>>,
  ) =>
    tell({
      val: VAL_CANVAS_MESSAGE,
      type: "pickElements",
      enabled: true,
      active: false,
      modifier: "alt",
      keepPicked: true,
      ...over,
    });
  const altClick = (element: Element) =>
    act(() => {
      element.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          altKey: true,
        }),
      );
    });
  const picks = () =>
    posted.filter(
      (message) =>
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        message.type === "elementPicked",
    );

  it("does nothing until the studio asks", () => {
    const { getByText } = render(
      <>
        <section>
          <h2 className="mb-6">Worn for years</h2>
        </section>
        <ValCanvasBridge draftMode />
      </>,
    );
    altClick(getByText("Worn for years"));
    expect(picks()).toEqual([]);
  });

  it("picks an element Val never tagged, described, and the page never sees the click", () => {
    const { getByText } = render(
      <>
        <section>
          <h2 className="mb-6">Worn for years</h2>
        </section>
        <ValCanvasBridge draftMode />
      </>,
    );
    const heading = getByText("Worn for years");
    const pageClicks = jest.fn();
    heading.addEventListener("click", pageClicks);
    pickElements({});
    altClick(heading);
    expect(picks()).toEqual([
      {
        val: VAL_CANVAS_MESSAGE,
        type: "elementPicked",
        element: expect.objectContaining({
          tag: "h2",
          text: "Worn for years",
          classes: ["mb-6"],
        }),
      },
    ]);
    expect(pageClicks).not.toHaveBeenCalled();
  });

  it("stops when the studio says, and Esc ends Select", () => {
    const { getByText } = render(
      <>
        <p>Hello</p>
        <ValCanvasBridge draftMode />
      </>,
    );
    pickElements({ active: true });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(posted).toContainEqual({
      val: VAL_CANVAS_MESSAGE,
      type: "elementPickingStopped",
    });
    pickElements({ enabled: false });
    altClick(getByText("Hello"));
    expect(picks()).toEqual([]);
    expect(document.querySelector("[data-val-picker]")).toBeNull();
  });
});
