/**
 * Where the TanStack example listens.
 *
 * Its own `dev` script has to agree (`examples/tanstack/package.json`), because
 * `playwright.config.ts` starts the app with that script rather than with a
 * port of its own. 3457 is taken: `e2e/http/config.ts` runs the proxy-mode copy
 * of the Next example there, and a suite that starts both would otherwise have
 * one of them silently attach to the other's server.
 */
export const TANSTACK_APP_PORT = 3458;

/** Must match `examples/tanstack/val.config.ts`, which the Studio renders. */
export const TANSTACK_PROJECT = "valbuild/val-examples-tanstack";
