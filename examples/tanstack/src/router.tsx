import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

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
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
