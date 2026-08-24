import { useEffect, useState } from "react";

export type VisualViewport = {
  /** Height of the area actually visible to the user, in px. */
  height: number;
  /** How far the visual viewport has been pushed down the layout viewport. */
  offsetTop: number;
  /**
   * Height taken off the bottom of the layout viewport by the keyboard.
   *
   * `position: fixed` is resolved against the layout viewport, so a sheet
   * anchored to the bottom needs this as its offset to land on top of the
   * keyboard rather than underneath it.
   */
  keyboardInset: number;
  /** True once the visible area is meaningfully shorter than the window. */
  isKeyboardOpen: boolean;
};

/**
 * The part of the page the user can actually see.
 *
 * On iOS the software keyboard shrinks the *visual* viewport but leaves the
 * *layout* viewport alone. So `100vh` overflows, `100svh` is measured before
 * the keyboard exists, and anything `position: fixed` to the bottom — a chat
 * input, a save bar — ends up underneath the keyboard rather than above it.
 * `window.visualViewport` is the only thing that reports the truth, so
 * full-screen sheets size themselves from this instead of from CSS units.
 *
 * Falls back to the window's own size where the API is missing, which gives
 * the same result as `100svh` — the behaviour we had before.
 */
export function useVisualViewport(enabled: boolean): VisualViewport {
  const [state, setState] = useState<VisualViewport>(() => read());

  useEffect(() => {
    if (!enabled) return;
    const viewport = window.visualViewport;
    const onChange = () => setState(read());
    onChange();
    if (viewport) {
      // `resize` fires as the keyboard animates in; `scroll` fires when iOS
      // pans the visual viewport to keep a focused field visible, which moves
      // the top of the visible area without changing its height.
      viewport.addEventListener("resize", onChange);
      viewport.addEventListener("scroll", onChange);
    }
    window.addEventListener("orientationchange", onChange);
    return () => {
      if (viewport) {
        viewport.removeEventListener("resize", onChange);
        viewport.removeEventListener("scroll", onChange);
      }
      window.removeEventListener("orientationchange", onChange);
    };
  }, [enabled]);

  return state;
}

/** Ratio below which the missing height is taken to be a keyboard. */
export const KEYBOARD_RATIO = 0.75;

/**
 * The geometry, as a pure function of what the browser reports.
 *
 * Split out from the hook so the arithmetic that decides whether the
 * assistant's input lands above the keyboard or under it can be tested
 * directly. A real iOS keyboard cannot be raised in CI; this can.
 */
export function computeVisualViewport(reported: {
  /** `visualViewport.height`, or undefined where the API is missing. */
  viewportHeight?: number;
  /** `visualViewport.offsetTop`, or undefined. */
  viewportOffsetTop?: number;
  /** `window.innerHeight` — the layout viewport. */
  windowHeight: number;
}): VisualViewport {
  const { viewportHeight, viewportOffsetTop, windowHeight } = reported;
  // Falling back to the layout viewport gives the same answer `100svh` did,
  // which is the behaviour this replaced.
  const height = viewportHeight ?? windowHeight;
  const offsetTop = viewportOffsetTop ?? 0;
  return {
    height,
    offsetTop,
    keyboardInset: Math.max(0, windowHeight - (offsetTop + height)),
    // Browser chrome collapsing on scroll also changes the height, so this
    // needs a threshold rather than any difference at all. A keyboard takes
    // far more than a URL bar does.
    isKeyboardOpen: height < windowHeight * KEYBOARD_RATIO,
  };
}

function read(): VisualViewport {
  if (typeof window === "undefined") {
    return { height: 0, offsetTop: 0, keyboardInset: 0, isKeyboardOpen: false };
  }
  return computeVisualViewport({
    viewportHeight: window.visualViewport?.height,
    viewportOffsetTop: window.visualViewport?.offsetTop,
    windowHeight: window.innerHeight,
  });
}

/**
 * Stops the page behind a full-screen sheet from scrolling while it is open.
 *
 * Without this, scrolling past the end of the sheet's own content hands the
 * scroll to the user's page underneath, which on iOS also drags the whole
 * visual viewport around.
 */
export function useLockBodyScroll(locked: boolean) {
  useEffect(() => {
    if (!locked) return;
    const { overflow, touchAction } = document.body.style;
    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "none";
    return () => {
      document.body.style.overflow = overflow;
      document.body.style.touchAction = touchAction;
    };
  }, [locked]);
}
