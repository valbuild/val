import {
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

/**
 * Shared helpers for the two Studio suites.
 *
 * `studio.spec.ts` drives the store system directly; `studio-ui.spec.ts` clicks
 * and types. Both have to wait for the same intake and start from the same clean
 * patch chain, so those live here rather than twice.
 */

/** Long enough for `next dev` to compile the route on the first test. */
const INTAKE_TIMEOUT = 60_000;

/**
 * Open the Studio and wait for it to take the project in.
 *
 * Intake, not a load event: the SPA bundle has to run, fetch its schema and
 * sources, and adopt the project. `__VAL_STORES__` is set by `ValStoreProvider`
 * once that is done.
 */
export async function openStudio(
  page: Page,
  /**
   * The Studio route to open. Defaults to the root.
   *
   * Takes a route rather than making callers `goto` afterwards, because a second
   * navigation throws away the intake this function waited for — and the failure
   * that produces is a locator finding nothing, which reads as a missing feature
   * rather than as a missing wait.
   */
  route = "/val",
): Promise<void> {
  await page.goto(route);
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
        timeout: INTAKE_TIMEOUT,
        message: "the store system never took the project in",
      },
    )
    .toBe(true);
}

/**
 * Throw away every patch on the server, so a run starts where the last one did.
 *
 * `examples/next/.val` is a fixture directory, gitignored and owned by whoever is
 * running the example app — which, for the length of a suite, is the suite.
 * Without this the chain grows on every run, `/stat` gets slower, and eventually
 * a test fails for a reason that has nothing to do with the code under test.
 */
export async function clearPatchChain(
  request: APIRequestContext,
): Promise<void> {
  const listed = await request.get("/api/val/patches");
  expect(listed.ok()).toBe(true);
  const body = (await listed.json()) as { patches: { patchId: string }[] };
  if (body.patches.length === 0) return;
  const query = body.patches
    .map((patch) => `id=${encodeURIComponent(patch.patchId)}`)
    .join("&");
  const deleted = await request.delete(`/api/val/patches?${query}`);
  expect(deleted.ok(), "could not clear the example app's patch chain").toBe(
    true,
  );
}

/** How many patches the store currently holds, straight from the system. */
export async function chainLength(page: Page): Promise<number> {
  return page.evaluate(() => {
    const bag = window as unknown as {
      __VAL_STORES__?: { system: { patchStore: { allRecords(): unknown[] } } };
    };
    return bag.__VAL_STORES__?.system.patchStore.allRecords().length ?? 0;
  });
}

/**
 * Throw away every patch the page holds, and wait for the store to agree.
 *
 * Looped rather than one pass over a snapshot of the ids. A write is debounced,
 * so one can land between reading the ids and the discard returning — leaving a
 * patch the discard never knew about, and a chain that never reaches zero. The
 * test that typed the value is not usually the one that fails: the leftover
 * patch is still there when the next spec asserts on the chain, so the failure
 * lands somewhere unrelated and only when the timing happens to line up.
 */
export async function discardAll(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      await discardOnce(page);
      return chainLength(page);
    })
    .toBe(0);
}

async function discardOnce(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const bag = window as unknown as {
      __VAL_STORES__: {
        system: {
          discard(ids: string[]): Promise<{ status: string; message?: string }>;
          patchStore: { allRecords(): { patchId: string }[] };
        };
      };
    };
    const system = bag.__VAL_STORES__.system;
    const ids = system.patchStore.allRecords().map((record) => record.patchId);
    if (ids.length === 0) return;
    const res = await system.discard(ids);
    if (res.status !== "discarded") {
      throw new Error(`could not discard: ${res.message ?? res.status}`);
    }
  });
}

/**
 * Open one of the shell's navigation panels.
 *
 * The floating shell keeps navigation behind the left rail rather than always
 * on screen, so a test that wants to click a page has to open the panel first.
 * The rail button and the panel's own header share a name, hence `.first()`.
 */
/**
 * A floating panel, by the title in its header.
 *
 * Settings is one of them: it is not a content destination — it is reached from
 * the cog at the foot of the rail rather than from the strip of three — but it
 * is the same panel with the same close button, so the helpers take it too.
 */
export type PanelName = "Pages" | "Media" | "Data" | "Settings";

export async function openNavPanel(
  page: Page,
  panel: PanelName,
): Promise<Locator> {
  const studio = page.locator("#val-shadow-root");
  await studio.getByRole("button", { name: panel }).first().click();
  return studio;
}

/**
 * Expand a row in the Pages panel, by name.
 *
 * Nothing is expanded on mount — a real site map has sections with hundreds of
 * rows — so reaching a nested page means opening the rows above it. A row that
 * is also a page selects itself as well, which is what clicking it does in the
 * app too.
 */
export async function expandRow(studio: Locator, name: string): Promise<void> {
  await studio.getByRole("button", { name, exact: true }).first().click();
}

/**
 * Open the Pages panel and expand the site map down to the top level.
 *
 * The root of the site map is the home page on this project, so every other
 * page is nested under it: without opening `/` there is nothing else to click.
 */
export async function openSiteMap(page: Page): Promise<Locator> {
  const studio = await openNavPanel(page, "Pages");
  await expandRow(studio, "/");
  return studio;
}

/**
 * Close the navigation panel, leaving the editor unobstructed.
 *
 * Not tidiness: an open panel has a filter input of its own, so a test that
 * reaches for "the first input" while one is open can end up typing into the
 * filter. Closing is also what an editor does once they have picked a page.
 */
export async function closeNavPanel(
  studio: Locator,
  panel: PanelName,
): Promise<void> {
  await studio.getByRole("button", { name: `Close ${panel}` }).click();
}
