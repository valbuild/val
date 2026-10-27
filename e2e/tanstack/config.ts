/**
 * Where the TanStack example listens.
 *
 * Its own `dev` script has to agree (`examples/tanstack/package.json`), because
 * `playwright.config.ts` starts the app with that script rather than with a
 * port of its own. Not 3456 (the Next example) or 3459 (the proxy-mode copy of
 * this app, `e2e/http/config.ts`): a suite that starts several would otherwise
 * have one silently attach to another's server.
 */
export const TANSTACK_APP_PORT = 3458;

/** Must match `examples/tanstack/val.config.ts`, which the Studio renders. */
export const TANSTACK_PROJECT = "valbuild/val-examples-tanstack";
