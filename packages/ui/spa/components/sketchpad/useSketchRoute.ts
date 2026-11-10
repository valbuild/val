import { useCallback, useEffect, useRef, useState } from "react";
import { isRoutePattern } from "./routePatterns";

/**
 * The page a sketch is about, and the Studio's preview following it.
 *
 * The page is the one last pressed in the sketch -- a route divider's "Show
 * it in the preview" -- and until then its first route, or, for a sketch
 * with none yet, the page it was started from. Whenever it changes it is
 * shown in the Studio's one preview (`onShowRoute`); the Sketchpad has no
 * preview of its own. Only a page: a page type (`/blog/[slug]`) is not one.
 *
 * `pressed` says the person asked for it, as opposed to the sketch opening
 * on its first page: on a phone that is a reason to go and look.
 *
 * A first route the person did not press is followed only once it is one
 * of the site's pages (`knownRoutes`): a divider being typed passes through
 * `/b`, `/bl` and `/blo` on its way to `/blog`, and the preview -- and the
 * content editor that follows it -- must not go to each.
 */
export function useSketchRoute({
  sketchId,
  routesInSketch,
  startedFrom,
  knownRoutes,
  onShowRoute,
}: {
  /** Which sketchpad is open: another one starts on its own first page. */
  sketchId: string | null;
  routesInSketch: readonly string[];
  /** The page the sketch was started from, when it has no route of its own. */
  startedFrom: string | null;
  /** The site's pages. Absent: every route is followed. */
  knownRoutes?: readonly string[];
  onShowRoute: (route: string, how: { pressed: boolean }) => void;
}): { activeRoute: string | null; pressRoute: (route: string) => void } {
  const [pressedRoute, setPressedRoute] = useState<string | null>(null);
  useEffect(() => setPressedRoute(null), [sketchId]);
  /** Whether the next page shown is one the person pressed. */
  const pressing = useRef(false);
  const activeRoute = pressedRoute ?? routesInSketch[0] ?? startedFrom ?? null;
  const onShowRouteRef = useRef(onShowRoute);
  onShowRouteRef.current = onShowRoute;
  const knownRef = useRef(knownRoutes);
  knownRef.current = knownRoutes;
  useEffect(() => {
    const pressed = pressing.current;
    pressing.current = false;
    if (activeRoute === null || isRoutePattern(activeRoute)) return;
    const known = knownRef.current;
    if (!pressed && known !== undefined && !known.includes(activeRoute)) {
      return;
    }
    onShowRouteRef.current(activeRoute, { pressed });
  }, [activeRoute]);
  /**
   * A route pressed in the sketch. Pressed again on the page already shown
   * it is still a request to look at it, though nothing changes here.
   */
  const pressRoute = useCallback(
    (route: string) => {
      if (route === activeRoute) {
        if (!isRoutePattern(route)) {
          onShowRouteRef.current(route, { pressed: true });
        }
        return;
      }
      pressing.current = true;
      setPressedRoute(route);
    },
    [activeRoute],
  );
  return { activeRoute, pressRoute };
}
