import { TANSTACK_APP_PORT } from "./tanstack/config";

/**
 * The two fs-mode apps the `chromium` project drives.
 *
 * Most of the suite drives `examples/tanstack` -- TanStack Start is the
 * primary release target, and its e2e fixtures (`examples/tanstack/content/`,
 * switched on by `VAL_E2E_FIXTURES`) are the same modules the Next example
 * has. A few specs pin themselves to `examples/next` with `test.use({ baseURL:
 * NEXT_APP_URL })`, so `@valbuild/next` keeps end-to-end coverage: `smoke` and
 * `insecure-context`, which the blocking `smoke` CI job runs against Next on
 * purpose, and the canvas suite (`canvas.next.spec.ts`), since the overlay and
 * the canvas bridge are a copy per framework.
 */
export const NEXT_APP_URL = "http://localhost:3456";

/** The fs-mode copy of `examples/tanstack`: the default for `chromium`. */
export const TANSTACK_APP_URL = `http://localhost:${TANSTACK_APP_PORT}`;
