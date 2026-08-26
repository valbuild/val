import { KEYBOARD_RATIO, computeVisualViewport } from "./useVisualViewport";

/**
 * The geometry a full-screen sheet is positioned from.
 *
 * These numbers decide whether the assistant's input and the edit sheet's
 * Save button land above the software keyboard or underneath it. A real iOS
 * keyboard cannot be raised in CI, so what is pinned here is the arithmetic,
 * against the values an iPhone actually reports.
 */

/** iPhone 14, Safari, portrait. */
const PHONE_HEIGHT = 844;
/** `visualViewport.height` on that phone with the keyboard up. */
const WITH_KEYBOARD = 508;
/** Height of Safari's chrome that collapses when you scroll down. */
const URL_BAR = 90;

describe("computeVisualViewport", () => {
  test("no keyboard: the sheet fills the screen, nothing to offset", () => {
    expect(
      computeVisualViewport({
        viewportHeight: PHONE_HEIGHT,
        viewportOffsetTop: 0,
        windowHeight: PHONE_HEIGHT,
      }),
    ).toEqual({
      height: PHONE_HEIGHT,
      offsetTop: 0,
      keyboardInset: 0,
      isKeyboardOpen: false,
    });
  });

  test("keyboard up: the inset is exactly the space it took", () => {
    const viewport = computeVisualViewport({
      viewportHeight: WITH_KEYBOARD,
      viewportOffsetTop: 0,
      windowHeight: PHONE_HEIGHT,
    });
    expect(viewport.isKeyboardOpen).toBe(true);
    // A sheet anchored `bottom: keyboardInset` then sits on the keyboard.
    expect(viewport.keyboardInset).toBe(PHONE_HEIGHT - WITH_KEYBOARD);
    expect(viewport.height).toBe(WITH_KEYBOARD);
  });

  test("Safari panning the visual viewport counts against the inset", () => {
    // iOS scrolls the visual viewport to keep a focused field visible, moving
    // the top of the visible area without resizing it. A sheet that ignored
    // `offsetTop` would hang below the keyboard again.
    const viewport = computeVisualViewport({
      viewportHeight: WITH_KEYBOARD,
      viewportOffsetTop: 60,
      windowHeight: PHONE_HEIGHT,
    });
    expect(viewport.offsetTop).toBe(60);
    expect(viewport.keyboardInset).toBe(PHONE_HEIGHT - (60 + WITH_KEYBOARD));
  });

  test("a collapsing URL bar is not mistaken for a keyboard", () => {
    // Otherwise the sheet would resize itself every time the user scrolled.
    const viewport = computeVisualViewport({
      viewportHeight: PHONE_HEIGHT - URL_BAR,
      viewportOffsetTop: 0,
      windowHeight: PHONE_HEIGHT,
    });
    expect(viewport.isKeyboardOpen).toBe(false);
    expect(viewport.keyboardInset).toBe(URL_BAR);
  });

  test("the threshold separates those two cases, with room either side", () => {
    // Guards the constant itself: a URL bar has to fall on one side of it and
    // a keyboard on the other, or the two become indistinguishable.
    expect(WITH_KEYBOARD / PHONE_HEIGHT).toBeLessThan(KEYBOARD_RATIO);
    expect((PHONE_HEIGHT - URL_BAR) / PHONE_HEIGHT).toBeGreaterThan(
      KEYBOARD_RATIO,
    );
  });

  test("without the API it behaves as 100svh did", () => {
    expect(computeVisualViewport({ windowHeight: PHONE_HEIGHT })).toEqual({
      height: PHONE_HEIGHT,
      offsetTop: 0,
      keyboardInset: 0,
      isKeyboardOpen: false,
    });
  });

  test("never reports a negative inset", () => {
    // Some Android states report a visual viewport taller than the layout
    // viewport; a negative `bottom` would lift the sheet off-screen.
    expect(
      computeVisualViewport({
        viewportHeight: PHONE_HEIGHT + 40,
        viewportOffsetTop: 0,
        windowHeight: PHONE_HEIGHT,
      }).keyboardInset,
    ).toBe(0);
  });
});
