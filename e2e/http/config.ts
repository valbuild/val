import { TANSTACK_PROJECT } from "../tanstack/config";

/**
 * The handful of values the mock content host, the proxy-mode app and the tests
 * all have to agree on.
 *
 * In one file because they are agreed across process boundaries: the mock is
 * started by `playwright.config.ts` with these in its environment, the app is
 * started with the same ones in its `VAL_*` vars, and the tests sign session
 * cookies with the same secret. A drift in any one of them shows up as an empty
 * patch list or a 401, neither of which points back here.
 *
 * Ports are deliberately not the fs-mode ones (3456 for Next, 3458 for
 * TanStack): the apps run at once, so a run can compare the modes without a
 * restart.
 */

/** Where the fake content.val.build listens. */
export const MOCK_CONTENT_PORT = 4568;

/**
 * Where the proxy-mode copy of `examples/tanstack` listens.
 *
 * Every proxy-mode spec drives this app: `e2e/http/` and the builder tab in
 * `e2e/tanstack-http/`. It was a copy of `examples/next` until `next dev` kept
 * failing these specs on its own manifests ("Manifest file is empty", "Unexpected
 * end of JSON input") -- and TanStack Start is the primary release target. Not
 * 3457, the old app's port, so a server left running from before the move is
 * not silently attached to.
 */
export const HTTP_APP_PORT = 3459;

/**
 * The project's api key, as the app holds it and the mock checks it.
 *
 * The mock rejects anything else rather than merely requiring a key to be
 * present: a mis-wired `VAL_API_KEY` is a real failure mode, and one that
 * otherwise surfaces as "no changes" rather than as an error.
 */
export const MOCK_API_KEY = "mock-api-key";

/**
 * What `val_session` cookies are signed with.
 *
 * The tests mint their own instead of logging in — `http` mode refuses every
 * request without a session, and the login flow is neither what these tests are
 * for nor something a mock content host can stand in for.
 */
export const MOCK_SECRET = "mock-secret-for-e2e-only";

/** Must match `val.config.ts`'s `project`, which the app sends on every call. */
export const MOCK_PROJECT = TANSTACK_PROJECT;

/** `VAL_GIT_COMMIT`: the commit the app believes it was built from. */
export const MOCK_INITIAL_COMMIT = "mockcommit0";

/** `val.config.ts`'s `root`, which the content host joins paths against. */
export const MOCK_ROOT = "/examples/tanstack";
