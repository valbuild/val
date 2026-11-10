/**
 * @jest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { useSketchRoute } from "./useSketchRoute";

/**
 * A route divider drives the Studio's one preview: the Sketchpad has none of
 * its own, so what it says to show is `onShowRoute`, which the Studio turns
 * into the preview's route (`ValShell`'s `onCanvasRouteChange`).
 */
describe("the page a sketch is about, in the Studio's preview", () => {
  const ROUTES = ["/", "/about", "/journal/[slug]"];

  const setup = (routesInSketch: string[] = ROUTES) => {
    const shown: Array<[string, { pressed: boolean }]> = [];
    const hook = renderHook(
      ({ sketchId }: { sketchId: string | null }) =>
        useSketchRoute({
          sketchId,
          routesInSketch,
          startedFrom: null,
          onShowRoute: (route, how) => shown.push([route, how]),
        }),
      { initialProps: { sketchId: "pad" } },
    );
    return { hook, shown };
  };

  test("opening a sketch shows its first page, not as a press", () => {
    const { hook, shown } = setup();
    expect(hook.result.current.activeRoute).toBe("/");
    expect(shown).toEqual([["/", { pressed: false }]]);
  });

  test("pressing a route divider moves the preview to that page", () => {
    const { hook, shown } = setup();
    act(() => hook.result.current.pressRoute("/about"));
    expect(hook.result.current.activeRoute).toBe("/about");
    expect(shown.at(-1)).toEqual(["/about", { pressed: true }]);
  });

  test("pressing the page already shown still asks to look at it", () => {
    const { hook, shown } = setup();
    act(() => hook.result.current.pressRoute("/"));
    expect(shown).toEqual([
      ["/", { pressed: false }],
      ["/", { pressed: true }],
    ]);
  });

  test("a page type is not a page, and is not shown", () => {
    const { hook, shown } = setup();
    act(() => hook.result.current.pressRoute("/journal/[slug]"));
    expect(shown).toEqual([["/", { pressed: false }]]);
  });

  test("another sketchpad starts on its own first page", () => {
    const { hook } = setup();
    act(() => hook.result.current.pressRoute("/about"));
    hook.rerender({ sketchId: "other" });
    expect(hook.result.current.activeRoute).toBe("/");
  });
});
