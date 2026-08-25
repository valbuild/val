import { test, expect, type Page, type ConsoleMessage } from "@playwright/test";

/**
 * The fast smoke test: does the Studio come up, and does it render?
 *
 * Deliberately shallow. `studio.spec.ts` and `studio-ui.spec.ts` write patches,
 * upload files and publish; those are worth their runtime but nobody runs them
 * before every commit. This one asks the smallest question that would have
 * caught the two worst regressions this branch shipped, and asks it of every
 * shape of module the example project has:
 *
 *   - the Studio mounts and takes the project in,
 *   - the module actually renders something,
 *   - and nothing threw.
 *
 * ## Why "nothing threw" is the assertion that earns its keep
 *
 * Both bugs a user found by hand were render loops — a component re-rendering
 * until React gave up with "Maximum update depth exceeded", thrown from inside a
 * Radix ref callback that names nothing about the cause. Nothing was broken
 * server-side, no request failed, and 1758 unit tests passed. The only signal
 * available from outside was an uncaught error in the page, so that is what this
 * watches.
 *
 * A render loop is also the one failure that a screenshot test would MISS while
 * looking healthy: the error boundary paints, so the page has content.
 *
 * ## Routes, and why these
 *
 * One per module shape, because the loops were shape-specific — they needed a
 * `.jsonValues()` record, or a router record, and the plain modules the earlier
 * tests used were clean throughout. A shape missing from this list is a shape
 * nothing checks.
 */

/**
 * Errors this environment produces whatever the Studio does.
 *
 * Enumerated rather than filtered by severity, so a NEW error of any kind fails.
 * The AI ones need a personal access token that a local checkout has no reason
 * to have; the certificate one is the sandbox's proxy CA, hit by the Google
 * Fonts stylesheet the app links.
 */
const ALLOWED_CONSOLE_ERRORS: { pattern: RegExp; why: string }[] = [
  {
    pattern: /ERR_CERT_AUTHORITY_INVALID/,
    why: "the sandbox proxy's CA, on the Google Fonts stylesheet",
  },
  {
    pattern: /\/api\/val\/ai\//,
    why: "AI endpoints need a personal access token; a local checkout has none",
  },
  {
    pattern: /Could not read personal access token file/,
    why: "same, as the message rather than the URL",
  },
  {
    pattern: /the server responded with a status of (401|500)/,
    why: "the AI endpoints above, reported without their URL",
  },
];

function unexplained(message: ConsoleMessage): boolean {
  const text = message.text();
  const url = message.location().url;
  return !ALLOWED_CONSOLE_ERRORS.some(
    ({ pattern }) => pattern.test(text) || pattern.test(url),
  );
}

type PageProblems = {
  /** Uncaught errors — a render loop lands here. */
  thrown: string[];
  /** Console errors that are not on the allowlist above. */
  logged: string[];
};

function watchForProblems(page: Page): PageProblems {
  const problems: PageProblems = { thrown: [], logged: [] };
  page.on("pageerror", (error) => {
    problems.thrown.push(error.message.split("\n")[0]);
  });
  page.on("console", (message) => {
    if (message.type() === "error" && unexplained(message)) {
      problems.logged.push(message.text().split("\n")[0]);
    }
  });
  return problems;
}

/**
 * Open a Studio route and wait for the project to be taken in.
 *
 * Waits on the store system's own signal rather than a timeout: `received` is
 * set when `host.receive` has the project, which is the earliest moment any
 * assertion about rendering is meaningful.
 */
async function openModule(page: Page, route: string): Promise<void> {
  await page.goto(`/val/~${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () =>
      (
        window as unknown as {
          __VAL_STORES__?: { received: boolean };
        }
      ).__VAL_STORES__?.received === true,
    null,
    { timeout: 60_000 },
  );
}

/** The Studio renders inside a shadow root, so `page.locator` cannot see in. */
async function renderedText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const host = document.getElementById("val-shadow-root");
    return host?.shadowRoot?.textContent ?? "";
  });
}

const ROUTES: { route: string; shape: string; expect: RegExp }[] = [
  {
    route: "",
    shape: "the Studio itself, with no module open",
    expect: /content|explorer|sitemap/i,
  },
  {
    route: "/content/tags.val.ts",
    shape: "a small plain record",
    expect: /\w/,
  },
  {
    route: "/content/handbook.val.ts",
    shape: "a nested array, with select at two levels",
    expect: /\w/,
  },
  {
    route: '/app/generic/[[...path]]/page.val.ts?p="/generic"',
    shape: "a router record, at one key",
    expect: /\w/,
  },
  {
    route: "/app/blogs/[blog]/page.val.ts",
    shape: "a router record, at its root",
    expect: /\w/,
  },
];

test.describe("the Studio comes up and renders", () => {
  for (const { route, shape, expect: expected } of ROUTES) {
    test(`renders ${shape}`, async ({ page }) => {
      const problems = watchForProblems(page);

      await openModule(page, route);

      /**
       * Wait for a PAINT, then assert on it.
       *
       * Intake finishing is not the same as React having rendered: on a cold
       * `next dev` the SPA is still coming down when `__VAL_STORES__.received`
       * flips, so reading the shadow root once right after it returned an empty
       * string and failed a route that renders perfectly well.
       *
       * Polling for "something painted" rather than for the expected pattern is
       * deliberate: if the error boundary paints instead, this proceeds
       * immediately and the next line says so, rather than burning the whole
       * timeout waiting for content that is never coming.
       */
      await expect
        .poll(async () => (await renderedText(page)).length, {
          timeout: 30_000,
        })
        .toBeGreaterThan(0);

      // Something is on screen, and it is not the error boundary. Checked before
      // the throw assertions so a render loop reports as "the boundary painted"
      // rather than as an empty page.
      const text = await renderedText(page);
      expect(text).not.toMatch(/encountered an error/i);
      expect(text).toMatch(expected);

      // Settle, then look again: a render loop takes a moment to exhaust React's
      // update budget, so an assertion made the instant intake finishes would
      // pass on a page that is about to die.
      await page.waitForTimeout(3_000);

      expect(problems.thrown, `uncaught in the page on ${route}`).toEqual([]);
      expect(problems.logged, `console errors on ${route}`).toEqual([]);
      expect(await renderedText(page)).not.toMatch(/encountered an error/i);
    });
  }

  /**
   * KNOWN BROKEN — see the note on the loop below.
   *
   * `test.fail()` rather than `test.skip()`, deliberately: skipping hides the
   * bug and a green suite would imply this shape works. This asserts that it
   * does NOT, so the suite stays honest AND turns red the moment someone fixes
   * it, which is the reminder to delete this block.
   *
   * The shape: a `.jsonValues()` record whose entries load one request each, and
   * a router record that pulls the same entries in through its reference scan.
   * Entry arrivals re-render the rows, that moves the virtualizer's window, the
   * new window asks for more entries, and the cascade exhausts React's nested
   * update budget. Timing-dependent — it does not reproduce on every run — which
   * is its own reason to pin it here rather than trust a manual check.
   */
  for (const route of [
    "/content/kb.val.ts",
    "/app/support/[slug]/page.val.ts",
  ]) {
    test(`renders ${route} (known render loop)`, async ({ page }) => {
      // Inside the body, not beside it: called at describe level this applies to
      // every test in the scope, which quietly marks the passing routes above as
      // expected-to-fail.
      test.fail();
      const problems = watchForProblems(page);
      await openModule(page, route);
      await page.waitForTimeout(6_000);
      expect(problems.thrown, `uncaught in the page on ${route}`).toEqual([]);
    });
  }
});
