import { placeInlineToolbar, type ViewportBox } from "./placeInlineToolbar";

/** The preview's visible part: 800 wide, from 100 to 700 down the screen. */
const clip: ViewportBox = { top: 100, left: 300, width: 800, height: 600 };
const size = { width: 200, height: 40 };
const field = (top: number, height = 60, left = 400): ViewportBox => ({
  top,
  left,
  width: 500,
  height,
});

describe("where the formatting controls go", () => {
  test("above the text, with its left edge, when there is room", () => {
    expect(placeInlineToolbar(field(300), clip, size)).toEqual({
      shown: true,
      side: "above",
      // 8 between the bar and the text.
      top: 300 - 8 - 40,
      left: 400,
    });
  });

  test("below it, when the text is at the top of the preview", () => {
    // 20 down from the top edge: a bar above would be cut off by the pane.
    expect(placeInlineToolbar(field(120), clip, size)).toEqual({
      shown: true,
      side: "below",
      top: 120 + 60 + 8,
      left: 400,
    });
  });

  test("...and when its first lines have scrolled off the top", () => {
    const placed = placeInlineToolbar(field(40, 200), clip, size);
    expect(placed).toMatchObject({ side: "below", top: 248 });
  });

  test("inside the preview, at its top edge, when the text is taller than it", () => {
    // From above the top edge to below the bottom one.
    expect(placeInlineToolbar(field(-200, 1500), clip, size)).toEqual({
      shown: true,
      side: "inside",
      top: 104,
      left: 400,
    });
  });

  test("...or at its bottom edge, when the caret is near the top", () => {
    const caret: ViewportBox = { top: 150, left: 420, width: 1, height: 20 };
    expect(placeInlineToolbar(field(-200, 1500), clip, size, caret)).toEqual({
      shown: true,
      side: "inside",
      top: 700 - 4 - 40,
      left: 400,
    });
  });

  test("never outside the preview sideways", () => {
    // The text starts left of the pane (the page is zoomed in and panned).
    expect(placeInlineToolbar(field(300, 60, 100), clip, size)).toMatchObject({
      left: 304,
    });
    // ...or so far right the bar would run off it.
    expect(placeInlineToolbar(field(300, 60, 1050), clip, size)).toMatchObject({
      left: 1100 - 200 - 4,
    });
  });

  test("a bar wider than the preview starts at its left edge", () => {
    expect(
      placeInlineToolbar(field(300), clip, { width: 900, height: 40 }),
    ).toMatchObject({ left: 304 });
  });

  test("not shown while the text is scrolled out of the preview", () => {
    expect(placeInlineToolbar(field(-300, 100), clip, size)).toEqual({
      shown: false,
    });
    expect(placeInlineToolbar(field(800, 100), clip, size)).toEqual({
      shown: false,
    });
  });
});
