import type { Page } from "@playwright/test";

/**
 * Whether the Studio's store system has taken the project in -- and `false`,
 * not an error, while the page is being reloaded under it.
 *
 * A dev server reloads the page when the first load discovers a dependency it
 * had not optimized yet (Vite), and an `evaluate` that lands in that reload
 * throws "Execution context was destroyed". `expect.poll` does not retry a
 * callback that throws, so the reload the warm-ups exist to absorb failed
 * them in two seconds instead -- on CI, from a cold cache, on every branch.
 * Any other error is still thrown.
 */
export async function storesReceived(page: Page): Promise<boolean> {
  try {
    return await page.evaluate(() => {
      const bag = window as unknown as {
        __VAL_STORES__?: { received: boolean };
      };
      return bag.__VAL_STORES__?.received === true;
    });
  } catch (error) {
    if (
      error instanceof Error &&
      /Execution context was destroyed|navigation/i.test(error.message)
    ) {
      return false;
    }
    throw error;
  }
}
