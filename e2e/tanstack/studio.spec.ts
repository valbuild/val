import { expect } from "@playwright/test";
import { openStudio, patchThroughStore, test } from "../studio";
import { expectInsecure, makeInsecure } from "../insecureContext";
import { renderedText, watchForProblems } from "../pageProblems";
import { TANSTACK_PROJECT } from "./config";

/**
 * Does the Studio come up on TanStack Start, and can it write?
 *
 * The whole of the TanStack suite, deliberately: this is a catastrophe
 * detector, not a second copy of `studio.spec.ts`. Everything about the STORES
 * is framework-independent and already covered against the Next app; what is
 * not covered anywhere else is the part that differs — `@valbuild/tanstack`'s
 * provider, its `/api/val/$` route, and the `/val` layout route serving a SPA
 * that navigates within itself.
 *
 * ## Why this file exists
 *
 * `crypto.randomUUID is not a function`: the Studio died on first render for
 * anyone who opened a TanStack template over plain http on a LAN address, was
 * reported by a user, and every job in CI was green. Two gaps let it through,
 * and only both together explain it:
 *
 *   1. Nothing ran the TanStack app at all. `examples/tanstack` was built by no
 *      CI job and opened by no test, so a break that was TanStack-only would
 *      have shipped just as quietly.
 *   2. Every test runs on `localhost`, which is a secure context — so even the
 *      Next smoke test could not have caught this particular crash. See
 *      `../insecureContext.ts`.
 *
 * ## The cost, since that is the reason it stayed small
 *
 * One job, three tests, about a minute. `vite dev` is ready in ~1s and compiles
 * lazily, and `playwright.config.ts` starts only the servers the selected
 * project needs — so this project starts the SPA and this app, and neither
 * `next dev` nor the mock content host.
 */
test.describe("the Studio on TanStack Start", () => {
  test("the site renders", async ({ page }) => {
    const problems = watchForProblems(page);

    await page.goto("/");
    // The tagline, from `src/content/site.val.ts` and read with `useVal`: the
    // provider resolving during SSR and surviving hydration, rather than a
    // static string in the route file. Matched in full because the hero title
    // in the index route module starts with the same words.
    await expect(
      page.getByText("Content as code, in a TanStack Start app."),
    ).toBeVisible();

    // After hydration, because a provider that throws on the client leaves the
    // server's HTML on screen looking perfectly healthy.
    await page.waitForTimeout(2_000);
    expect(problems.thrown, "uncaught in the page").toEqual([]);
  });

  test("the Studio mounts and renders", async ({ page }) => {
    const problems = watchForProblems(page);

    await openStudio(page);

    // The project name comes from the config the SPA fetched through the
    // TanStack API route, so matching it proves the route answered and the
    // shell rendered against real data rather than its own placeholders.
    await expect
      .poll(async () => renderedText(page), { timeout: 30_000 })
      .toMatch(new RegExp(TANSTACK_PROJECT));

    // Settle, then look again: a render loop takes a moment to exhaust React's
    // update budget, so an assertion made the instant intake finishes would
    // pass on a page that is about to die.
    await page.waitForTimeout(3_000);
    expect(await renderedText(page)).not.toMatch(/encountered an error/i);
    expect(problems.thrown, "uncaught in the page").toEqual([]);
    expect(problems.logged, "console errors").toEqual([]);
  });

  test("the Studio mounts and writes outside a secure context", async ({
    page,
  }) => {
    const problems = watchForProblems(page);

    await makeInsecure(page);
    await openStudio(page);
    await expectInsecure(page);

    expect(await renderedText(page)).toMatch(new RegExp(TANSTACK_PROJECT));

    // A patch id is minted on a path no render reaches, so mounting is only
    // half of it. This throws if the store refuses the write, and it is also
    // the one assertion here that the TanStack API route accepts a write.
    await patchThroughStore(page, "/src/content/site.val.ts", [
      { op: "replace", path: ["footer"], value: "Built with Val Build!" },
    ]);

    expect(problems.thrown, "uncaught in the page").toEqual([]);
  });
});
