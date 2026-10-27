/** @jest-environment jsdom */
import { StrictMode } from "react";
import { act, renderHook } from "@testing-library/react";
import { usePickingDefault } from "./usePickingDefault";
import { CanvasView } from "./types";

/**
 * The picking default, under a React that renders twice.
 *
 * Wrapped in {@link StrictMode} deliberately, and that is the whole test: it
 * invokes the component body twice per render and keeps the second result, which
 * is the cheap, deterministic version of what React does whenever it discards a
 * render. The first version of this held the previous view in a REF, and under
 * exactly that double invocation the ref mutation survived while the
 * `setIsPicking` beside it did not — so switching to the fields view left
 * picking off, the canvas showed the fields list, and clicking anything on the
 * page reported nothing at all.
 */
function render(initialView: CanvasView) {
  return renderHook((view: CanvasView) => usePickingDefault(view), {
    initialProps: initialView,
    wrapper: StrictMode,
  });
}

describe("the canvas picking default", () => {
  test("the normal view starts with picking off", () => {
    const { result } = render("normal");
    expect(result.current[0]).toBe(false);
  });

  test("opening straight into the fields view starts with it on", () => {
    const { result } = render("fields");
    expect(result.current[0]).toBe(true);
  });

  test("switching to the fields view arms picking", () => {
    const { result, rerender } = render("normal");
    expect(result.current[0]).toBe(false);
    rerender("fields");
    expect(result.current[0]).toBe(true);
  });

  test("switching back to the normal view disarms it", () => {
    const { result, rerender } = render("fields");
    rerender("normal");
    expect(result.current[0]).toBe(false);
    // And back again: the default is applied on every switch, not just the first.
    rerender("fields");
    expect(result.current[0]).toBe(true);
  });

  test("the button overrides the default, and the default does not fight back", () => {
    const { result, rerender } = render("fields");
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
    // Re-rendering with the same view must not re-apply the default — that is
    // the point of the override: reading the page normally while still being
    // able to select a piece of it.
    rerender("fields");
    expect(result.current[0]).toBe(false);
  });

  test("selecting on the page in the normal view survives a re-render", () => {
    const { result, rerender } = render("normal");
    act(() => result.current[1](true));
    rerender("normal");
    expect(result.current[0]).toBe(true);
  });
});
