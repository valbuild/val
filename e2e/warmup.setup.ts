import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

/**
 * Pay the app's first-use costs before the suite starts timing anything.
 *
 * `next dev` compiles a route the first time it is requested, Vite transforms the
 * SPA's modules on the same terms, and two of the Studio's workers are built the
 * first time something needs them. So whichever test goes first pays for a build
 * — while its own `expect` timeout is running. That cost is real work the app has
 * to do, but it is not the app's behaviour, and charging it to whichever test
 * happens to be first is what made this suite flaky in a way that moved between
 * runs:
 *
 * - `canvas.spec.ts` waits for the canvas frame to render `/blogs/blog1`. It is
 *   the only spec that loads a blog route, so it always paid for that compile. It
 *   was given 20s, then 60s, and still failed on a loaded runner — because the
 *   number was never the thing that was wrong.
 * - `list-diff.spec.ts` and `compare.spec.ts` wait 30s for the first diff line,
 *   which is the first construction of the patch-sets worker.
 * - `studio.spec.ts`'s own comment records the validation worker doing this
 *   already: "A fixed wait was long enough while validation ran in-process and
 *   became a flake the moment it moved to a thread."
 *
 * A test's timeout should be a statement about the app being responsive, not a
 * bet on how fast a compiler is on the box the run landed on.
 *
 * ## Two halves, because HTTP is not enough
 *
 * The first version of this file warmed routes with `request.get`, which compiles
 * Next's routes and nothing else: a bare HTML GET never runs the page, so the
 * SPA's module graph is never fetched from Vite and neither worker is ever
 * constructed. `openStudio`'s 60s intake poll and `diffLines`' 30s were still
 * absorbing all of it. So the second half drives a real browser.
 *
 * A project dependency rather than a `globalSetup`, because `globalSetup` runs
 * before `webServer` does: there would be nothing up to warm. As a project it
 * runs after the servers are ready, Playwright reports it like a test, and it
 * runs in EVERY shard — verified with `--list` — which is what a sharded CI run
 * needs, since each shard is its own cold checkout.
 *
 * Only the `fs`-mode app is warmed. `chromium-http` gets its own servers and
 * would want the same treatment, but it is not currently flaky and warming it on
 * an `fs`-only run would mean compiling an app that run never visits.
 */

/**
 * Generous, and deliberately so. This is the wait for a cold compile on a loaded
 * CI runner — the thing every other timeout in the suite is trying not to be.
 */
const COMPILE_TIMEOUT = 180_000;

/**
 * The routes to build, cheapest first.
 *
 * `/val` first, because everything else in the suite goes through it. Then the
 * app routes the canvas specs point a frame at, which are otherwise compiled
 * inside an assertion about the canvas.
 *
 * Query strings are left off: `next dev` compiles a route, not a URL, so
 * `/val/~/content/lists.val.ts?p=…` and `/val` are the same build.
 */
const ROUTES = [
  "/val",
  "/",
  "/blogs/blog1",
  "/blogs/blog2",
  "/support/getting-started",
] as const;

/**
 * A module and path the probe can read, chosen because the example app always
 * has it and `studio.spec.ts` already relies on it.
 */
const PROBE_PATH = '/content/authors.val.ts?p="teddy"."name"';

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

/** The store system has taken the project in. See `openStudio`. */
async function waitForIntake(page: Page, what: string): Promise<void> {
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
        timeout: COMPILE_TIMEOUT,
        message: `${what} never took the project in`,
      },
    )
    .toBe(true);
}

/** Every worker script this page has constructed, in order. */
function workersBuilt(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const bag = window as unknown as { __WARMUP_WORKERS__?: string[] };
    return bag.__WARMUP_WORKERS__ ?? [];
  });
}

test("the app has compiled the routes the suite visits", async ({
  request,
}) => {
  test.setTimeout(COMPILE_TIMEOUT * 2);
  for (const route of ROUTES) {
    await warm(request, route);
  }
});

test("the Studio's bundle and both workers are built", async ({ page }) => {
  test.setTimeout(COMPILE_TIMEOUT * 2);

  /**
   * Record every `new Worker(...)`, so this can assert it did its job.
   *
   * Without it the warmup would be a sequence of navigations that LOOK like they
   * build the workers, and a refactor moving either construction — behind a
   * condition, into a lazier component — would silently take the warmup away
   * while every test kept passing, slower and closer to its timeout again. The
   * subclass calls `super`, so the page behaves exactly as it would have.
   */
  await page.addInitScript(() => {
    const built: string[] = [];
    (window as unknown as { __WARMUP_WORKERS__: string[] }).__WARMUP_WORKERS__ =
      built;
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(scriptURL: string | URL, options?: WorkerOptions) {
        built.push(String(scriptURL));
        super(scriptURL, options);
      }
    };
  });

  // The SPA itself: Vite transforms its module graph on this first load, which
  // is what `openStudio`'s 60s intake poll has been absorbing.
  await page.goto("/val");
  await waitForIntake(page, "the Studio");

  /**
   * The validation worker, through the hook a real field uses.
   *
   * `ValStoreProbe` mounts on a path handed to it at runtime and calls
   * `useModuleValidation`, which is what reaches `schemaValidationBridge`'s
   * `ensureWorker()`. Driving the probe needs no patch and leaves no state
   * behind — which matters, because a warmup that dirtied the chain would break
   * every spec that reads the fixture's own content.
   */
  await page.evaluate((path) => {
    const bag = window as unknown as {
      __VAL_STORE_PROBE__?: (next: string) => void;
    };
    if (bag.__VAL_STORE_PROBE__ === undefined) {
      throw new Error("the Studio's test probe is not on window");
    }
    bag.__VAL_STORE_PROBE__(path);
  }, PROBE_PATH);

  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const root = document.getElementById("val-shadow-root");
          const scope = root?.shadowRoot ?? document;
          const raw = scope
            .querySelector("[data-val-store-probe]")
            ?.getAttribute("data-val-store-probe");
          return raw === null || raw === undefined
            ? null
            : (JSON.parse(raw) as { validation: string }).validation;
        }),
      {
        timeout: COMPILE_TIMEOUT,
        message: "validation never completed, so its worker is not warm",
      },
    )
    .toBe("validated");

  /**
   * The patch-sets worker, by going to the compare view.
   *
   * Straight to the route rather than through Quick actions: that panel's
   * "Review N changes" item only exists once there IS a change, and the warmup
   * deliberately makes none. `usePatchSetsWorker` builds its worker in an effect
   * on mount, and `ValShell` mounts `ComparePatchSets` as soon as the patch sets
   * have loaded — empty or not — so an empty chain still pays the construction.
   */
  await page.goto("/val/compare");
  await waitForIntake(page, "the compare view");

  await expect
    .poll(() => workersBuilt(page), {
      timeout: COMPILE_TIMEOUT,
      message: "the Studio's workers were never constructed",
    })
    .toEqual(
      expect.arrayContaining([
        expect.stringContaining("validation.worker"),
        expect.stringContaining("patchsets.worker"),
      ]),
    );
});
