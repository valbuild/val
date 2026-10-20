import fs from "fs";
import { expect, test, type Page } from "@playwright/test";
import {
  discardAll,
  mock,
  openHttpStudio,
  peek,
  publishAll,
  sessionCookie,
  writePatch,
} from "./httpMode";

/**
 * A local file in a project with remote files, found by "Check everything" on
 * `/val/validate` and uploaded by its **Fix**.
 *
 * Why it matters: a hosted project starts with its template's images local,
 * and has no repository and no CLI to run `val validate --fix` in. The Studio
 * is the only place they can be moved to remote storage.
 *
 * The local entry is seeded as a draft: a patch adding a key under the remote
 * gallery's directory, with its bytes stored as a LOCAL file. That is the same
 * state as a template's committed image -- a local key in a `.remote()`
 * gallery -- without a fixture file in `examples/next/public`, which the
 * gallery would then list as untracked everywhere else.
 */

const MODULE = "/content/remoteImages.val.ts";
const IMAGE = "e2e/fixtures/blue-8x8.png";
const KEY = "/public/remote-images/seeded_00000.png";
const METADATA = { width: 8, height: 8, mimeType: "image/png" };

test.use({
  storageState: { cookies: [sessionCookie("ada")], origins: [] },
});

test.describe.configure({ mode: "serial" });

test.beforeEach(async () => {
  await mock.reset();
});

/** Every `file` op in the chain, as `[filePath, remote]`. */
function fileOps(page: Page): Promise<[string, boolean][]> {
  return page.evaluate(() => {
    const store = (
      window as unknown as {
        __VAL_STORES__: {
          system: {
            patchStore: {
              allRecords(): {
                patch: { op: string; filePath?: string; remote?: boolean }[];
              }[];
            };
          };
        };
      }
    ).__VAL_STORES__.system.patchStore;
    return store
      .allRecords()
      .flatMap((record) =>
        record.patch
          .filter((op) => op.op === "file")
          .map((op): [string, boolean] => [op.filePath ?? "", !!op.remote]),
      );
  });
}

test("Check everything reports a local file in a remote gallery, and Fix uploads it", async ({
  page,
}) => {
  await openHttpStudio(page);
  const bytes = fs.readFileSync(IMAGE).toString("base64");
  await writePatch(page, MODULE, [
    { op: "add", path: [KEY], value: { ...METADATA, alt: null } },
    {
      op: "file",
      path: [KEY],
      filePath: KEY,
      value: `data:image/png;base64,${bytes}`,
      remote: false,
      metadata: METADATA,
    },
  ]);

  await page.goto("/val/validate");
  const studio = page.locator("#val-shadow-root");
  await studio.getByRole("button", { name: "Check everything" }).click();

  // An error row, with a Fix, not the command a hosted project cannot run.
  const row = studio.getByRole("listitem").filter({
    hasText: "this one is still a local file",
  });
  await expect(row).toHaveCount(1, { timeout: 60_000 });
  await expect(row.getByText("val validate --fix")).toHaveCount(0);
  await row.getByRole("button", { name: "Fix" }).click();
  await expect(
    row.getByText(/Uploads seeded_00000\.png when published/),
  ).toBeVisible({ timeout: 30_000 });

  // The entry is keyed by its remote ref now, and the bytes went with it,
  // flagged remote.
  const peeked = await peek(page, MODULE);
  const source =
    typeof peeked === "object" && peeked !== null && "data" in peeked
      ? peeked.data
      : undefined;
  const keys = Object.keys(
    typeof source === "object" && source !== null ? source : {},
  );
  expect(keys).toHaveLength(1);
  const [ref] = keys;
  expect(ref).toMatch(
    /^https:\/\/.+\/file\/p\/.+public\/remote-images\/seeded_00000\.png$/,
  );
  expect(await fileOps(page)).toContainEqual([ref, true]);

  // And publishing puts it in remote storage.
  const published = await publishAll(page, "Upload a local image");
  expect(published.status, published.message ?? "").toBe("published");
  const state = await mock.state();
  expect(
    state.remoteFiles.some((file) =>
      file.includes("public/remote-images/seeded_00000.png"),
    ),
    "the file was not moved to remote storage",
  ).toBe(true);
});

test.afterEach(async ({ page }) => {
  await discardAll(page).catch(() => undefined);
});
