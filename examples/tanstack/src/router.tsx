import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { NotFound } from "./components/NotFound";

export function getRouter() {
  return createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: "intent",
    /*
     * Zero, so an edit is never served from a preload.
     *
     * `ValProvider` brings an edit across by calling `router.invalidate()`,
     * which re-runs the loaders of the matches on screen. A preloaded match
     * with a stale time would keep answering from the preload cache instead,
     * which looks exactly like an edit that did not save.
     */
    defaultPreloadStaleTime: 0,
    /*
     * A page a route serves no content for is a 404, and it has to be one the
     * app renders.
     *
     * Val's route modules make this ordinary rather than exceptional: a key
     * that is not in the record is a page that does not exist, and the
     * component says so by throwing `notFound()`. Without a handler that throw
     * reaches the root, where TanStack logs "a notFoundError was encountered on
     * the route with ID __root__" and renders its own bare fallback — and
     * during server rendering it also aborts the response, which surfaces as an
     * `AbortError` from the node adapter rather than as a 404.
     */
    defaultNotFoundComponent: NotFound,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
