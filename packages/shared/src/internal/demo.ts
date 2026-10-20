/**
 * A Val demo, as the page hands it to the Studio.
 *
 * In a demo the Studio talks to Val's own server running in the same tab
 * (`@valbuild/server/browser`) instead of to an API route, and the page that
 * starts that server is the app's (`<ValApp demo>`) while the Studio is a
 * separate bundle loaded by a script tag. A window property is how the two
 * meet, the same way `window.__VAL_MODULES__` hands the Studio the project's
 * modules. See `docs/plans/demo-mode.md`.
 */
export type ValDemoRuntime = {
  /**
   * Sends a Studio request to the in-tab server. Passed to `createValClient`.
   *
   * The server holds its edits in memory, so starting the demo over is
   * reloading the page: there is nothing stored to clear.
   */
  fetch: (input: string, init: RequestInit) => Promise<Response>;
  /**
   * Whether uploads work here. They need the demo's service worker, which
   * relays the upload and the unpublished files to this tab's server, and a
   * service worker needs a secure context. Where it cannot run the Studio
   * refuses uploads before sending anything, and says why.
   */
  uploads: boolean;
};

/*
 * A global `var` rather than a `Window` member: this package is compiled
 * without the DOM's types, and a `var` in global scope is also a property of
 * `window` where they exist.
 */
declare global {
  var __VAL_DEMO__: ValDemoRuntime | undefined;
}

/** The demo this page was started with, or null outside a demo. */
export function getValDemo(): ValDemoRuntime | null {
  return globalThis.__VAL_DEMO__ ?? null;
}
