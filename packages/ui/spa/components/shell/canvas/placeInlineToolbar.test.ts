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

/*
 * A field's validation errors float in the same box as the controls -- or
 * alone, for a string, which has no controls (`CanvasInlineEditFloat`) --
 * so they are placed by the same rule, at whatever size the box has grown
 * to with them in it.
 */
describe("where a field's validation errors go", () => {
  /** A bar with two lines of errors under it. */
  const withErrors = { width: 320, height: 40 + 4 + 56 };
  /** A string's errors, on their own. */
  const errorsAlone = { width: 260, height: 36 };

  const overlaps = (a: ViewportBox, b: ViewportBox) =>
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + b.height &&
    b.top < a.top + a.height;
  const inside = (a: ViewportBox, b: ViewportBox) =>
    a.left >= b.left &&
    a.top >= b.top &&
    a.left + a.width <= b.left + b.width &&
    a.top + a.height <= b.top + b.height;

  test("a string's errors go above it, as the controls of a richtext do", () => {
    expect(placeInlineToolbar(field(300), clip, errorsAlone)).toEqual({
      shown: true,
      side: "above",
      top: 300 - 8 - 36,
      left: 400,
    });
  });

  test("the box grown by its errors goes below a text it no longer fits above", () => {
    // Room for the bar alone above this one, not for the bar and errors.
    expect(placeInlineToolbar(field(160), clip, size)).toMatchObject({
      side: "above",
    });
    expect(placeInlineToolbar(field(160), clip, withErrors)).toMatchObject({
      side: "below",
      top: 160 + 60 + 8,
    });
  });

  test("never over the text, and never outside the preview, wherever the text is", () => {
    for (const box of [withErrors, errorsAlone]) {
      // Down the preview, and along it to past its right edge.
      for (let top = 100; top + 60 <= 700; top += 20) {
        for (const left of [300, 600, 1000]) {
          const text = field(top, 60, left);
          const placed = placeInlineToolbar(text, clip, box);
          if (!placed.shown) throw new Error(`hidden at ${top}`);
          const drawn = { top: placed.top, left: placed.left, ...box };
          expect(inside(drawn, clip)).toBe(true);
          expect(overlaps(drawn, text)).toBe(false);
        }
      }
    }
  });
});
