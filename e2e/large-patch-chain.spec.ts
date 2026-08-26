import { expect, test } from "@playwright/test";
import { openStudio } from "./studio";
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/**
 * A chain long enough to break the request that reads it.
 *
 * `GET /patches` filters by repeated `patch_id` params, so a chain of a few
 * hundred pending patches put a few hundred uuids in the query string — a 30KB
 * URL, which Node refuses with 431 before the handler sees it (a proxy in front
 * of it answers 413). The editor then loaded with no pending changes at all and
 * said nothing: stat named the patches, their ops never arrived, and every
 * patched field rendered published content.
 *
 * Only reproducible at scale, which is the whole reason this is an e2e and why
 * it builds its own chain: nothing a person does in a test writes 650 patches.
 */

const PATCHES_DIR = join(__dirname, "..", "examples/next/.val/patches");
const CHAIN_LENGTH = 650;
const MODULE = "/content/access.val.ts";
/** Matched against the running core, or the server treats the patch as foreign. */
const CORE_VERSION = (
  JSON.parse(
    readFileSync(join(__dirname, "..", "packages/core/package.json"), "utf-8"),
  ) as { version: string }
).version;

/**
 * Write a chain of patches straight onto disk, the way `ValOpsFS` stores them:
 * one directory per patch, NAMED BY ITS PARENT, holding a `patch.json`. The
 * first directory is `head`, and each one after it is named by the patch before
 * it. Written rather than typed because the point is the length — nothing a
 * person does in a test produces 650 patches.
 */
function writeChain(length: number, baseSha: string): string[] {
  const written: string[] = [];
  let parentDir = "head";
  let parentRef: Record<string, unknown> = {
    type: "head",
    headBaseSha: baseSha,
  };
  for (let i = 0; i < length; i++) {
    const patchId = randomUUID();
    const dir = join(PATCHES_DIR, parentDir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "patch.json"),
      JSON.stringify({
        patch: [{ op: "replace", path: ["editable"], value: `Typed ${i}` }],
        patchId,
        parentRef,
        path: MODULE,
        authorId: null,
        sessionId: null,
        baseSha,
        coreVersion: CORE_VERSION,
        createdAt: new Date(Date.UTC(2026, 7, 26, 20, 0, i)).toISOString(),
      }),
    );
    written.push(dir);
    parentDir = patchId;
    parentRef = { type: "patch", patchId };
  }
  return written;
}

test.describe("a long patch chain", () => {
  let written: string[] = [];

  test.beforeAll(async ({ request }) => {
    // The chain has to be rooted at the base the server is actually on, or every
    // patch in it is refused as belonging to a different base.
    const listed = await request.get("/api/val/patches");
    expect(listed.ok(), "could not read the current base").toBe(true);
    const { baseSha } = (await listed.json()) as { baseSha: string };
    written = writeChain(CHAIN_LENGTH, baseSha);
  });

  test.afterAll(async () => {
    for (const dir of written) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("loads every patch, in requests the server accepts", async ({
    page,
  }) => {
    const patchRequests: { url: string; status: number }[] = [];
    page.on("response", (response) => {
      const url = response.url();
      if (url.includes("/api/val/patches")) {
        patchRequests.push({ url, status: response.status() });
      }
    });

    await openStudio(page);

    // The chain arrived: the store holds every patch stat announced. Asserted
    // through the store rather than the UI because the failure was silent — the
    // fields simply showed published content.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const bag = window as unknown as {
              __VAL_STORES__?: {
                system: { patchStore: { allRecords(): unknown[] } };
              };
            };
            return (
              bag.__VAL_STORES__?.system.patchStore.allRecords().length ?? 0
            );
          }),
        { timeout: 30000, message: "the store never loaded the chain" },
      )
      .toBeGreaterThanOrEqual(CHAIN_LENGTH);

    expect(patchRequests.length).toBeGreaterThan(0);
    for (const request of patchRequests) {
      // 431 / 413 are the two ways this failed. Any non-2xx here is the bug.
      expect(
        request.status,
        `GET /patches answered ${request.status} for a ${request.url.length} character URL`,
      ).toBeLessThan(400);
      // And the reason it does: no request carries more ids than a URL can hold.
      expect(request.url.length).toBeLessThan(4000);
    }

    // Nothing reported to the user, because nothing went wrong.
    await expect(
      page
        .locator("#val-shadow-root")
        .getByText("Unpublished changes could not be loaded."),
    ).toHaveCount(0);
  });
});

/**
 * And the other half: when the request fails anyway, the editor says so.
 *
 * The 431 is fixed above, but every other way of failing this request still
 * exists — offline, a 500, a proxy — and the failure mode was the same in all of
 * them: stat named the pending patches, their ops never arrived, and the fields
 * they touch rendered published content with nothing on screen saying why.
 * Indistinguishable from the edits having been discarded.
 */
test.describe("a patch fetch the server refuses", () => {
  let written: string[] = [];

  test.beforeAll(async ({ request }) => {
    const listed = await request.get("/api/val/patches");
    expect(listed.ok()).toBe(true);
    const { baseSha } = (await listed.json()) as { baseSha: string };
    written = writeChain(1, baseSha);
  });

  test.afterAll(async () => {
    for (const dir of written) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("is reported to the user, not only to the console", async ({ page }) => {
    // Only the READ is broken: stat still announces the patch, which is what
    // makes the missing ops invisible without this report.
    await page.route(
      (url) => url.pathname.endsWith("/api/val/patches"),
      async (route) => {
        if (route.request().method() !== "GET") {
          await route.fallback();
          return;
        }
        await route.fulfill({ status: 413, body: "" });
      },
    );

    await openStudio(page);

    await expect(
      page.getByText("Unpublished changes could not be loaded."),
    ).toBeVisible({ timeout: 15000 });
  });
});
