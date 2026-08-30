import { expect } from "@playwright/test";
import { openStudio, testKeepingChain as test } from "./studio";
import { existsSync, readFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { appendPatch, FSPatch } from "../packages/server/src/patchStore";
import {
  withPatchLock,
  PATCH_LOCK_FILE_NAME,
} from "../packages/server/src/patchLock";

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

/**
 * The store lives under the WORKER's own app copy, not the checkout's.
 *
 * Each worker runs its own server with its own cwd, which is what `fs` mode
 * takes as its root (see `workerApp.ts`), so a path baked in at module scope
 * would have every worker fabricating its chain into one shared directory —
 * the exact interference the copies exist to remove.
 */
const valDir = (rootDir: string) => join(rootDir, ".val");
const patchesDir = (rootDir: string) => join(valDir(rootDir), "patches");
const lockFile = (rootDir: string) =>
  join(valDir(rootDir), PATCH_LOCK_FILE_NAME);
const CHAIN_LENGTH = 650;
const MODULE = "/content/access.val.ts";
/** Matched against the running core, or the server treats the patch as foreign. */
const CORE_VERSION = (
  JSON.parse(
    readFileSync(join(__dirname, "..", "packages/core/package.json"), "utf-8"),
  ) as { version: string }
).version;

/**
 * Build a chain of patches through the store's own write path.
 *
 * `appendPatch` writes exactly what the running server would: the record
 * under `<patchId>/patch.json`, then a line in `patches.log` — the CURRENT
 * on-disk contract (see `architecture/patch-store.md`), which replaced a
 * layout where a directory was named after its PARENT rather than itself.
 * Fabricating the old shape by hand is what silently rotted this spec when
 * that store was rewritten: a chain in the old format is not merely
 * unreadable, every one of its directories reads as crash debris and gets
 * swept, so the spec failed claiming the store never loaded a chain that was
 * never really written.
 *
 * `appendPatch` must run under the same lock the server takes for every write
 * — done once here, around the whole loop, rather than 650 separate
 * acquisitions or 650 real `PUT /patches` round trips: the point of this
 * fixture is the chain's LENGTH, not exercising the HTTP path a second time,
 * and 650 synchronous file writes take a fraction of a second held once.
 * `FSPatch.parse` is what gives each record its branded `baseSha` — the
 * schema is the one place that type exists, so parsing through it is the way
 * to produce one without asserting past the type.
 */
async function writeChain(
  rootDir: string,
  length: number,
  baseSha: string,
): Promise<void> {
  const locked = await withPatchLock(
    lockFile(rootDir),
    { ttlMs: 30_000, op: "e2e large-patch-chain setup" },
    () => {
      for (let i = 0; i < length; i++) {
        const record = FSPatch.parse({
          patch: [{ op: "replace", path: ["editable"], value: `Typed ${i}` }],
          patchId: randomUUID(),
          path: MODULE,
          authorId: null,
          sessionId: null,
          baseSha,
          coreVersion: CORE_VERSION,
          createdAt: new Date(Date.UTC(2026, 7, 26, 20, 0, i)).toISOString(),
        });
        appendPatch(patchesDir(rootDir), record);
      }
    },
  );
  if (locked.status !== "ok") {
    throw new Error(`could not build the fixture chain: ${locked.message}`);
  }
}

/**
 * Remove every patch on disk, fabricated or otherwise — the same way
 * `ValOpsFS.deleteAllPatches` does, and for the same reason.
 *
 * `readPatchStore`'s reads are deliberately lock-free (`architecture/patch-
 * store.md`), which is only safe because every WRITE is ordered so a reader
 * mid-write can never see a log entry whose directory is already gone. A
 * plain recursive `rmSync` over the whole tree does not honor that: it can
 * delete a patch's directory before it gets to `patches.log`, and a reader
 * polling in that window sees the log still naming the patch and its
 * `patch.json` already missing — "something is wrong with the patch store",
 * which is exactly what a first version of this cleanup produced under load.
 * Renaming the directory away first is a single atomic syscall: from any
 * reader's point of view the store either fully exists or does not exist at
 * all, with nothing in between to observe.
 */
async function clearPatches(rootDir: string): Promise<void> {
  const locked = await withPatchLock(
    lockFile(rootDir),
    { ttlMs: 30_000, op: "e2e large-patch-chain cleanup" },
    () => {
      if (!existsSync(patchesDir(rootDir))) return;
      const tmpDir = join(
        valDir(rootDir),
        `patches-e2e-cleanup-${randomUUID()}`,
      );
      renameSync(patchesDir(rootDir), tmpDir);
      rmSync(tmpDir, { recursive: true, force: true });
    },
  );
  if (locked.status !== "ok") {
    throw new Error(`could not clear the fixture chain: ${locked.message}`);
  }
}

test.describe("a long patch chain", () => {
  test.beforeAll(async ({ request, workerApp }) => {
    /**
     * An EMPTY chain first, and this is not tidiness.
     *
     * A patch another spec left behind can carry a `baseSha` this run's server
     * is not on, and reading a chain that applies to nothing fails this spec
     * reporting that the store loaded no patches, which is true and says
     * nothing about the code under test.
     */
    await clearPatches(workerApp.rootDir);
    // Rooted at the base the server is actually on, or every patch in it is
    // refused as belonging to a different one.
    const listed = await request.get("/api/val/patches");
    expect(listed.ok(), "could not read the current base").toBe(true);
    const { baseSha } = (await listed.json()) as { baseSha: string };
    await writeChain(workerApp.rootDir, CHAIN_LENGTH, baseSha);
  });

  test.afterAll(async ({ workerApp }) => {
    // Six hundred patches left for the next spec make its failure somebody
    // else's puzzle.
    await clearPatches(workerApp.rootDir);
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
  test.beforeAll(async ({ request, workerApp }) => {
    await clearPatches(workerApp.rootDir);
    const listed = await request.get("/api/val/patches");
    expect(listed.ok()).toBe(true);
    const { baseSha } = (await listed.json()) as { baseSha: string };
    await writeChain(workerApp.rootDir, 1, baseSha);
  });

  test.afterAll(async ({ workerApp }) => {
    await clearPatches(workerApp.rootDir);
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
