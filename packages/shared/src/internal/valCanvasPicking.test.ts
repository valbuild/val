import {
  isValCanvasPageMessage,
  isValCanvasStudioMessage,
  VAL_CANVAS_MESSAGE,
} from "./valCanvasProtocol";

describe("picking any element, over the canvas protocol", () => {
  const pick = {
    val: VAL_CANVAS_MESSAGE,
    type: "pickElements",
    enabled: true,
    active: false,
    modifier: "alt",
    keepPicked: true,
  };

  test("the studio's pickElements is read whole", () => {
    expect(isValCanvasStudioMessage(pick)).toBe(true);
  });

  test("...and refused with a modifier the page does not know, or a part missing", () => {
    expect(isValCanvasStudioMessage({ ...pick, modifier: "hyper" })).toBe(
      false,
    );
    expect(isValCanvasStudioMessage({ ...pick, active: undefined })).toBe(
      false,
    );
  });

  const element = {
    tag: "h2",
    text: "Worn for years, not weeks",
    classes: ["text-2xl"],
    selector: "section:nth-of-type(2) > h2",
  };

  test("a pick from the page carries the element described", () => {
    expect(
      isValCanvasPageMessage({
        val: VAL_CANVAS_MESSAGE,
        type: "elementPicked",
        element,
      }),
    ).toBe(true);
    expect(
      isValCanvasPageMessage({
        val: VAL_CANVAS_MESSAGE,
        type: "elementPicked",
        element: { ...element, valPath: '/app/page.val.ts?p="title"' },
      }),
    ).toBe(true);
  });

  test("...and anything else in its place is not a pick", () => {
    expect(
      isValCanvasPageMessage({
        val: VAL_CANVAS_MESSAGE,
        type: "elementPicked",
        element: { ...element, classes: [1] },
      }),
    ).toBe(false);
    expect(
      isValCanvasPageMessage({
        val: VAL_CANVAS_MESSAGE,
        type: "elementPicked",
      }),
    ).toBe(false);
  });

  test("Esc on the page is a message of its own", () => {
    expect(
      isValCanvasPageMessage({
        val: VAL_CANVAS_MESSAGE,
        type: "elementPickingStopped",
      }),
    ).toBe(true);
  });
});
