import { expect, type APIRequestContext, type Page } from "@playwright/test";

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
export async function openStudio(page: Page): Promise<void> {
  await page.goto("/val");
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

/** Throw away every patch the page holds, and wait for the store to agree. */
export async function discardAll(page: Page): Promise<void> {
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
  await expect.poll(() => chainLength(page)).toBe(0);
}
