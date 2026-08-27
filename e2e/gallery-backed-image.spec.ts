import { expect, test } from "@playwright/test";
import {
  clearPatchChain,
  discardAll,
  openStudio,
  peekThroughStore,
} from "./studio";

const MODULE = "/content/mediaFields.val.ts";
const IMAGE = "e2e/fixtures/blue-8x8.png";

/**
 * A gallery-backed image field, which has no `metadata` of its own.
 *
 * `createFilePatch` is called with `skipMetadataInReplace` for a referenced
 * module, so the field's value is deliberately just `{_ref, _type, _tag}` — the
 * width, height and mimeType live on the gallery's entry, which is the point of
 * referencing one. Two things in `ImageField` assumed otherwise.
 */
test.describe("an image field backed by a gallery", () => {
  test.beforeEach(async ({ request }) => {
    await clearPatchChain(request);
  });

  async function uploadInto(page: import("@playwright/test").Page) {
    await openStudio(page, `/val/~${MODULE}?p=%22fromGallery%22`);
    const studio = page.locator("#val-shadow-root");
    await studio
      .locator('input[type="file"]:not([multiple])')
      .first()
      .setInputFiles(IMAGE);
    await expect(
      studio.getByRole("button", { name: "Focal point" }),
    ).toBeVisible({ timeout: 30000 });
    return studio;
  }

  /** The upload lands, with the dimensions where they belong. */
  test("uploads, with its dimensions on the gallery entry", async ({
    page,
  }) => {
    const studio = await uploadInto(page);

    // The upload really did work: the gallery holds the dimensions, and the
    // thumbnail decoded. Asserted first, so a silent FAILURE cannot pass this.
    const gallery = (await peekThroughStore(
      page,
      "/content/mediaFixtures.val.ts",
    )) as Record<string, { width?: unknown; height?: unknown }> | null;
    const uploaded = gallery?.["/public/test/subdir/blue-8x8_8b441.png"];
    expect(uploaded?.width).toBe(8);
    expect(uploaded?.height).toBe(8);
    await expect
      .poll(() =>
        studio
          .locator("img")
          .first()
          .evaluate((node) => (node as HTMLImageElement).naturalWidth),
      )
      .toBe(8);

    await discardAll(page);
  });

  /**
   * Its focal point toggle works, and setting it does not produce a warning.
   *
   * Two bugs, and they meet here, which is why one test covers both.
   *
   * Turning the hotspot on only wrote a patch when there was already a
   * `metadata` object to add to — which a gallery-backed field never has. So the
   * click wrote nothing, and since the checkbox is `checked={!!hotspot}`, read
   * from source, it snapped straight back to off: a toggle that refused to
   * toggle.
   *
   * Making it work is also what creates the state the OTHER bug needed:
   * `metadata: {hotspot}` with no width or height. That is correct for this kind
   * of field — the dimensions are the gallery's — and it was warned about as
   * "undefined and undefined", reaching editors as a complaint about an upload
   * that had gone perfectly well.
   */
  test("can turn its focal point on, without warning about missing dimensions", async ({
    page,
  }) => {
    const warnings: string[] = [];
    page.on("console", (msg) => {
      if (/Expected metadata width and height/.test(msg.text())) {
        warnings.push(msg.text());
      }
    });

    const studio = await uploadInto(page);
    await studio.getByRole("button", { name: "Focal point" }).click();

    const toggle = studio.locator('[id^="hotspot_toggle:"]').first();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");

    // And it is in source, not only on screen.
    await expect
      .poll(async () => {
        const value = (await peekThroughStore(
          page,
          '/content/mediaFields.val.ts?p="fromGallery"',
        )) as { metadata?: { hotspot?: unknown } } | null;
        return JSON.stringify(value?.metadata?.hotspot ?? null);
      })
      .toBe(JSON.stringify({ x: 0.5, y: 0.5 }));

    // The partial metadata the toggle just wrote is correct for this field, so
    // nothing complained about it.
    expect(warnings).toEqual([]);

    await discardAll(page);
  });
});
