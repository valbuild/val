import * as fs from "fs";
import { expect, test, type Page } from "@playwright/test";
import { clearPatchChain, openStudio } from "../studio";
import { serverSource } from "./serverState";

/**
 * `s.fontset()`, against the showcase's `fonts.val.ts` and the
 * `s.file(fontsVal)` field `media.val.ts` holds.
 *
 * What is asserted is that a face was LOADED, not that an element names one:
 * a `font-family` on a face the browser could not read falls back to the next
 * family silently, and a screenshot of the fallback looks like a working
 * preview.
 */
const SET = "/src/content/fonts.val.ts";
const FONT =
  "examples/tanstack/public/val/fonts/nunito-sans-regular_49fe0.woff2";

test.beforeEach(async ({ request }) => {
  await clearPatchChain(request);
});

/** The families of the faces the document has loaded, by prefix. */
function loadedFaces(page: Page, prefix: string): Promise<string[]> {
  return page.evaluate(async (prefix) => {
    await document.fonts.ready;
    return [...document.fonts]
      .filter((face) => face.status === "loaded")
      .map((face) => face.family.replace(/"/g, ""))
      .filter((family) => family.startsWith(prefix));
  }, prefix);
}

test("the page sets its sample in the font the field picked", async ({
  page,
}) => {
  await page.goto("/showcase");
  await expect(
    page.getByText("The quick brown fox jumps over the lazy dog"),
  ).toBeVisible();
  await expect
    .poll(() => loadedFaces(page, "showcase-nunito-sans-bold"))
    .toHaveLength(1);
});

test("the gallery previews each font in itself", async ({ page }) => {
  await openStudio(page, `/val/~${SET}`);
  const studio = page.locator("#val-shadow-root");
  await expect(studio.getByText("Aa", { exact: true })).toHaveCount(2, {
    timeout: 30_000,
  });
  await expect
    .poll(() => loadedFaces(page, "val-font-preview-"), { timeout: 30_000 })
    .toHaveLength(2);

  await studio.getByText("nunito-sans-bold_6bccb.woff2").click();
  const panel = studio.getByRole("complementary", {
    name: "nunito-sans-bold_6bccb.woff2 details",
  });
  await expect(panel.getByText("Aa Gg")).toBeVisible();
  await panel.getByLabel("Preview text").fill("Blank AS");
  await expect(panel.getByText("Blank AS")).toHaveCount(3);
});

test("a font the browser gives no type is stored by what its bytes are", async ({
  page,
  request,
}) => {
  await openStudio(page, `/val/~${SET}`);
  const studio = page.locator("#val-shadow-root");
  await expect(studio.getByText("Aa", { exact: true })).toHaveCount(2, {
    timeout: 30_000,
  });
  // Different bytes from the committed entry, so a new hash and a new key.
  const bytes = Buffer.concat([fs.readFileSync(FONT), Buffer.alloc(4)]);
  await studio
    .locator('input[type="file"]')
    .first()
    .setInputFiles({ name: "Upload.woff2", mimeType: "", buffer: bytes });

  await expect
    .poll(
      async () => {
        const source = await serverSource(request, SET);
        return typeof source === "object" && source !== null
          ? Object.entries(source).filter(([key]) => key.includes("/upload_"))
          : [];
      },
      { timeout: 30_000 },
    )
    .toEqual([
      [
        expect.stringMatching(
          /^\/public\/val\/fonts\/upload_[0-9a-f]{5}\.woff2$/,
        ),
        // `patch_id` too: the server marks an entry whose bytes are a draft.
        expect.objectContaining({ mimeType: "font/woff2" }),
      ],
    ]);
});
