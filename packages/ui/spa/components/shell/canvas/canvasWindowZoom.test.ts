import {
  anchoredScroll,
  clampScale,
  fitScale,
  MAX_SCALE,
  MIN_SCALE,
  screenSpan,
} from "./CanvasWindow";

/**
 * The maths behind "zoom towards the thing I am pointing at".
 *
 * Worth testing on its own because every way of getting it wrong looks the same
 * from outside — the page drifts under the pointer — and none of them is
 * visible in a screenshot. It is also the one part of the window that cannot be
 * checked by using it: a drift of a few pixels per frame is invisible until it
 * has accumulated over a gesture.
 *
 * A plain object stands in for the element: `anchoredScroll` reads four numbers
 * off it and nothing else, which is deliberate.
 */
function windowOf(
  clientWidth: number,
  clientHeight: number,
  scrollLeft = 0,
  scrollTop = 0,
) {
  return { clientWidth, clientHeight, scrollLeft, scrollTop };
}

describe("anchoredScroll", () => {
  /** A page big enough that the window scrolls in both directions. */
  const page = { width: 1280, height: 2000 };

  test("the point under the pointer stays under the pointer", () => {
    const el = windowOf(800, 600, 200, 400);
    const at = { x: 500, y: 700 };
    const next = anchoredScroll(el, page, 1, 2, at, at);

    // Where the anchor was on screen before, and where it is after. The whole
    // contract is that these are the same number.
    const before = -el.scrollLeft + at.x * 1;
    const after = -next.x + at.x * 2;
    expect(after).toBeCloseTo(before);
    expect(-next.y + at.y * 2).toBeCloseTo(-el.scrollTop + at.y * 1);
  });

  test("zooming out holds the same point too", () => {
    const el = windowOf(800, 600, 300, 900);
    const at = { x: 640, y: 1000 };
    const next = anchoredScroll(el, page, 1, 0.5, at, at);
    // Vertically the page still overflows at half size (1000px of page in a
    // 600px window), so the anchor is held exactly.
    expect(-next.y + at.y * 0.5).toBeCloseTo(-el.scrollTop + at.y);
    // Horizontally it no longer does — 640px of page in an 800px window — and
    // once a page fits, the window CENTRES it. Nothing can hold an anchor
    // against that, and the answer accounts for the centring rather than
    // pretending to: the offset is in it.
    const offsetAfter = (800 - 1280 * 0.5) / 2;
    expect(offsetAfter + at.x * 0.5 - next.x).toBeCloseTo(at.x - el.scrollLeft);
  });

  test("a pinch that does not change span moves the page by the finger travel", () => {
    // Fingers that slide 60px to the right across the page, at 1:1, should move
    // the page 60px right — which is 60px LESS scroll.
    const el = windowOf(800, 600, 200, 400);
    const hold = { x: 500, y: 700 };
    const at = { x: 560, y: 700 };
    const next = anchoredScroll(el, page, 1, 1, at, hold);
    expect(next.x).toBeCloseTo(el.scrollLeft - 60);
    expect(next.y).toBeCloseTo(el.scrollTop);
  });

  test("a pinch settles instead of chasing itself", () => {
    /*
     * The failure this guards against: the fingers are reported in the PAGE's
     * coordinates, and the page is what we just moved. Feed the result back in
     * — the fingers have not moved on screen, so their page coordinate has
     * shifted by exactly what we scrolled — and a formula written against the
     * previous frame instead of the gesture's origin keeps accelerating.
     */
    const hold = { x: 500, y: 700 };
    let el = windowOf(800, 600, 200, 400);
    let at = { x: 560, y: 700 };

    const first = anchoredScroll(el, page, 1, 1, at, hold);
    // The finger did not move; the content under it did.
    const moved = first.x - el.scrollLeft;
    el = windowOf(800, 600, first.x, first.y);
    at = { x: at.x + moved, y: at.y };

    const second = anchoredScroll(el, page, 1, 1, at, hold);
    expect(second.x).toBeCloseTo(first.x);
  });

  test("a page smaller than the window is centred, and the centring is accounted for", () => {
    // 400px of page in an 800px window sits 200px in. A zoom about a point has
    // to know that, or it lands off by half the difference — which is the bug
    // that made zooming feel like it dragged the page sideways.
    const small = { width: 400, height: 300 };
    const el = windowOf(800, 600);
    const at = { x: 200, y: 150 };
    const next = anchoredScroll(el, small, 1, 1.5, at, at);

    const offsetBefore = (800 - 400 * 1) / 2;
    const offsetAfter = (800 - 400 * 1.5) / 2;
    expect(offsetAfter + at.x * 1.5 - next.x).toBeCloseTo(
      offsetBefore + at.x * 1 - el.scrollLeft,
    );
  });
});

describe("fitScale", () => {
  test("fits by whichever side runs out first", () => {
    // A tall page in a wide window is limited by height.
    expect(
      fitScale({ width: 400, height: 2000 }, { width: 2000, height: 1048 }),
    ).toBeCloseTo(0.5);
    // And a wide one in a tall window by width.
    expect(
      fitScale({ width: 2000, height: 400 }, { width: 1048, height: 2000 }),
    ).toBeCloseTo(0.5);
  });

  test("never returns a scale outside what the window will show", () => {
    // A phone-sized pane showing a desktop page is the case that matters: the
    // floor has to be low enough to reach, or the window claims to be showing
    // the whole page while it overflows.
    const phone = fitScale(
      { width: 1280, height: 800 },
      { width: 340, height: 520 },
    );
    expect(phone).toBeGreaterThanOrEqual(MIN_SCALE);
    expect(phone).toBeLessThanOrEqual(1);
    expect(1280 * phone).toBeLessThanOrEqual(340);

    // And a tiny page in a huge window is not blown up past the ceiling.
    expect(
      fitScale({ width: 100, height: 100 }, { width: 4000, height: 4000 }),
    ).toBe(MAX_SCALE);
  });

  test("survives a window that has not been laid out yet", () => {
    // Measured before the pane has a size, which happens on the first frame.
    // Any finite scale will do; a NaN or an Infinity would be written into the
    // URL and restored on the next load.
    const scale = fitScale(
      { width: 1280, height: 800 },
      { width: 0, height: 0 },
    );
    expect(Number.isFinite(scale)).toBe(true);
    expect(scale).toBeGreaterThan(0);
  });
});

/**
 * A pinch, run frame by frame the way a real one arrives.
 *
 * The single-frame version of this test passes against the broken code, which
 * is exactly why it is written as a loop: on the first `move` the scale is
 * still the one the gesture started at, so the wrong unit and the right one
 * give the same answer. It takes two frames for them to diverge, and after that
 * they never agree again.
 *
 * The page reports the span in ITS pixels, so what it sends back depends on the
 * zoom the studio has just applied — that feedback is the whole hazard, and is
 * modelled here rather than assumed away.
 */
function runPinch(
  startScale: number,
  /** The physical distance between the fingers, one entry per frame. */
  frames: number[],
): number[] {
  let scale = startScale;
  // `touchstart`: the page reports the span in its own pixels.
  const origin = { span: screenSpan(frames[0] / scale, scale), scale };
  const seen: number[] = [];
  for (const physical of frames.slice(1)) {
    const reported = physical / scale; // what the page measures, at this zoom
    const span = screenSpan(reported, scale);
    scale = clampScale(origin.scale * (span / origin.span));
    seen.push(scale);
  }
  return seen;
}

/** Where a pinch left the zoom. */
function endsAt(seen: number[]): number {
  return seen[seen.length - 1];
}

describe("a pinch", () => {
  test("settles instead of strobing when the fingers are held still", () => {
    // Fingers opened to 2x and then held there for ten frames. The scale must
    // reach 2x and STAY — under the page-pixel unit this alternates between 1x
    // and 2x forever, which on screen is the canvas flickering under the hand.
    const frames = [100, ...Array(10).fill(200)];
    const seen = runPinch(0.5, frames);
    for (const scale of seen) {
      expect(scale).toBeCloseTo(1);
    }
  });

  test("a pinch that ends where it began leaves the zoom where it found it", () => {
    // Out and back. The gesture is a ratio against its own start, so returning
    // the fingers has to return the zoom — no accumulated drift.
    expect(endsAt(runPinch(0.8, [120, 180, 240, 180, 120]))).toBeCloseTo(0.8);
  });

  test("the ratio is the ratio, whatever zoom it started from", () => {
    // Doubling the finger distance doubles the zoom, from anywhere.
    expect(endsAt(runPinch(0.25, [100, 200]))).toBeCloseTo(0.5);
    expect(endsAt(runPinch(0.5, [100, 200]))).toBeCloseTo(1);
    expect(endsAt(runPinch(1, [100, 50]))).toBeCloseTo(0.5);
  });

  test("holds at the limit rather than running away past it", () => {
    // Kept pinching after the ceiling: every later frame stays clamped rather
    // than accumulating a debt that has to be un-pinched before the zoom moves
    // again. A property of the clamp rather than of the unit — unlike the two
    // above, this one holds under the old formula too.
    const frames = [100, 400, 800, 1600, 1600, 1600];
    const seen = runPinch(1, frames);
    for (const scale of seen) {
      expect(scale).toBe(MAX_SCALE);
    }
  });
});
