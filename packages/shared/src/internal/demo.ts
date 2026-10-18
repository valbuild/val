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
  /** Sends a Studio request to the in-tab server. Passed to `createValClient`. */
  fetch: (input: string, init: RequestInit) => Promise<Response>;
  /** Forgets every edit, so the next load starts from the published content. */
  reset: () => void;
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
