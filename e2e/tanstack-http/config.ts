import { TANSTACK_PROJECT } from "../tanstack/config";

/**
 * Where the proxy-mode copy of `examples/tanstack` and its mock listen.
 *
 * Neither port is shared with anything else the suite starts, so a bare
 * `playwright test` can run every app at once: 3456 and 3457 are the two
 * copies of the Next example, 3458 is the fs-mode TanStack one, and 4567 is
 * the Next app's mock content host.
 *
 * A mock of its own rather than the Next app's: the mock is ONE project -- it
 * answers only requests that name `MOCK_CONTENT_PROJECT` -- and the TanStack
 * example's `val.config.ts` names a different one. The api key, the session
 * secret and the initial commit are shared from `../http/config.ts`, because
 * nothing about them differs between the two apps.
 */
export const TANSTACK_HTTP_APP_PORT = 3459;

/** Where the TanStack app's mock content host listens. */
export const TANSTACK_MOCK_CONTENT_PORT = 4568;

/** Must match `examples/tanstack/val.config.ts`, which the app sends. */
export const TANSTACK_HTTP_PROJECT = TANSTACK_PROJECT;

/** `examples/tanstack/val.config.ts`'s `root`. */
export const TANSTACK_ROOT = "/examples/tanstack";
