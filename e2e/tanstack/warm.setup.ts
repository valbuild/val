import { expect, test } from "@playwright/test";
import { TANSTACK_APP_PORT } from "./config";

/**
 * Load the Studio once before the TanStack tests time anything.
 *
 * Same reason as `../warmup.setup.ts`, and the first run of `studio.spec.ts`
 * proved it applies here too: an unexplained 404 and a reload during the very
 * first `/val` load, gone on every load after. Vite serves the SPA's module
 * graph on demand and re-optimizes when that load discovers a dependency it had
 * not bundled, which 404s the URLs already in flight and reloads the page — real
 * work the dev server has to do once, and nothing this suite is trying to
 * assert. Charging it to whichever test goes first is how a suite gets a flake
 * that moves between runs.
 *
 * A project dependency rather than a `globalSetup`, because `globalSetup` runs
 * before `webServer`: there would be nothing up to warm.
 *
 * Named `warm.setup.ts` rather than `warmup.setup.ts` on purpose: the Next
 * warmup project's `testMatch` is a bare filename, which Playwright matches
 * against every directory, so a second file by that name would be run by that
 * project too — against the Next app, on a run that never started one.
 */
test("the Studio's bundle is built and the TanStack app has compiled", async ({
  page,
}) => {
  // Generous: this is the cold compile every other timeout in the suite is
  // trying not to be.
  test.setTimeout(180_000);

  await page.goto(`http://localhost:${TANSTACK_APP_PORT}/val`);
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const bag = window as unknown as {
            __VAL_STORES__?: { received: boolean };
          };
          return bag.__VAL_STORES__?.received === true;
        }),
      {
        timeout: 120_000,
        message: "the Studio never took the TanStack project in",
      },
    )
    .toBe(true);
});
