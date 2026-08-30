import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * Compile the app's routes before the suite starts timing anything.
 *
 * `next dev` compiles a route the first time it is requested, and the SPA is a
 * Vite dev server that transforms its modules on the same terms. So the first
 * test to touch a route pays for a build — while its own `expect` timeout is
 * running. That cost is real work the app has to do, but it is not the app's
 * behaviour, and charging it to whichever test happens to go first is what made
 * this suite flaky in a way that moved around between runs:
 *
 * - `canvas.spec.ts` waits for the canvas frame to render `/blogs/blog1`. It is
 *   the only spec that loads a blog route, so it is always the one paying for
 *   that compile. It was given 20s, then 60s, and still failed on a loaded
 *   runner — because the number was never the thing that was wrong.
 * - `list-diff.spec.ts` opens the Studio and waits 30s for a field. Whether that
 *   is enough depends on whether an earlier spec already warmed the route, which
 *   depends on the order Playwright happened to pick.
 *
 * A test's timeout should be a statement about the app being responsive, not a
 * bet on how fast a compiler is on the box the run landed on. Warming here makes
 * every later timeout mean what it says, and moves the one legitimately slow
 * wait somewhere that being slow is expected — and where being BROKEN is
 * reported as a setup failure naming the route, rather than as a locator that
 * found nothing.
 *
 * A project dependency rather than a `globalSetup`, because `globalSetup` runs
 * before `webServer` does: there would be nothing up to warm. As a project it
 * runs after the servers are ready, and Playwright reports it like a test.
 *
 * Only the `fs`-mode app is warmed. `chromium-http` gets its own servers and
 * would want the same treatment, but it is not currently flaky, and warming it
 * on an `fs`-only run would mean compiling an app that run never visits.
 */

/**
 * Generous, and deliberately so. This is the wait for a cold compile on a loaded
 * CI runner — the thing every other timeout in the suite is trying not to be.
 */
const COMPILE_TIMEOUT = 180_000;

/**
 * The routes to build, cheapest first.
 *
 * `/val` first, because everything else in the suite goes through it and it
 * drags in the SPA bundle. Then the app routes the canvas specs point a frame
 * at, which are otherwise compiled inside an assertion about the canvas.
 *
 * Query strings are left off: `next dev` compiles a route, not a URL, so
 * `/val/~/content/lists.val.ts?p=…` and `/val` are the same build. What differs
 * per URL is the Studio's own client-side work, which is not what this is for.
 */
const ROUTES = [
  "/val",
  "/",
  "/blogs/blog1",
  "/blogs/blog2",
  "/support/getting-started",
] as const;

/**
 * Request a route until the server answers, and name the route if it never does.
 *
 * A plain `request.get` would already wait, but a route that fails to build
 * answers quickly with a 500 — so this polls the status rather than the request
 * completing, and a route that cannot compile fails here, named, instead of
 * surfacing later as a missing element in a test about something else.
 */
async function warm(request: APIRequestContext, url: string): Promise<void> {
  await expect
    .poll(
      async () => {
        try {
          return (
            await request.get(url, { timeout: COMPILE_TIMEOUT })
          ).status();
        } catch (err) {
          // The dev server can still be binding its port when the first request
          // goes out; report it rather than throwing out of the poll.
          return `unreachable: ${err instanceof Error ? err.message : err}`;
        }
      },
      { timeout: COMPILE_TIMEOUT, message: `${url} never compiled` },
    )
    .toBe(200);
}

test("the app has compiled the routes the suite visits", async ({
  request,
}) => {
  test.setTimeout(COMPILE_TIMEOUT * 2);
  for (const route of ROUTES) {
    await warm(request, route);
  }
});
