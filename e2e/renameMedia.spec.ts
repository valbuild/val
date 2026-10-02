import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import {
  clearPatchChain,
  discardAll,
  expectNoPatchesOnServer,
  openStudio,
  patchThroughStore,
} from "./studio";

/**
 * Renaming a media file from the Studio.
 *
 * A rename is three writes that all have to agree — the bytes at a new path,
 * the gallery entry (or the field) at the new name, and every field that names
 * it — so every test here checks all three, and checks that the image still
 * DECODES afterwards: `next dev` answers a path with no file behind it with the
 * app's HTML and a 200, so "the src looks right" proves nothing.
 *
 * Remote files are covered by `renameMediaFile.test.ts`: renaming one is a new
 * ref string and no request, and this suite has no remote content host.
 */

const GALLERY = "/content/mediaFixtures.val.ts";
const FIELDS = "/content/mediaFields.val.ts";
/** The gallery's one committed entry. */
const RED = "/public/test/subdir/red-8x8_bfbd0.png";
const RENAMED = "/public/test/subdir/crimson_bfbd0.png";
const IMAGE = "e2e/fixtures/blue-8x8.png";

test.beforeEach(async ({ request }) => {
  await clearPatchChain(request);
});

/**
 * One module's source as the SERVER has it, every pending patch applied.
 *
 * Asked of the server rather than the Studio's store: a rename that only
 * changed the client's view would pass a store read and publish nothing.
 */
async function serverSource(
  request: APIRequestContext,
  moduleFilePath: string,
): Promise<unknown> {
  const res = await request.put("/api/val/sources/~");
  expect(res.status(), await res.text()).toBe(200);
  const body: unknown = await res.json();
  if (
    typeof body !== "object" ||
    body === null ||
    !("modules" in body) ||
    typeof body.modules !== "object" ||
    body.modules === null
  ) {
    throw new Error(`not a sources response: ${JSON.stringify(body)}`);
  }
  const entry: unknown = Reflect.get(body.modules, moduleFilePath);
  return typeof entry === "object" && entry !== null && "source" in entry
    ? entry.source
    : undefined;
}

async function serverKeys(
  request: APIRequestContext,
  moduleFilePath: string,
): Promise<string[]> {
  const source = await serverSource(request, moduleFilePath);
  return typeof source === "object" && source !== null
    ? Object.keys(source)
    : [];
}

/** Every `file` op the server holds, as `filePath` → whether it adds bytes. */
async function serverFileOps(
  request: APIRequestContext,
): Promise<[string, boolean][]> {
  const res = await request.get("/api/val/patches");
  expect(res.ok(), `the server refused the request: ${res.status()}`).toBe(
    true,
  );
  const body = (await res.json()) as {
    patches: {
      patch?: { op: string; filePath?: string; value?: unknown }[];
    }[];
  };
  return body.patches.flatMap((patch) =>
    (patch.patch ?? [])
      .filter((op) => op.op === "file")
      .map((op): [string, boolean] => [op.filePath ?? "", op.value !== null]),
  );
}

async function rename(page: Page, to: string) {
  const studio = page.locator("#val-shadow-root");
  await studio.getByRole("button", { name: "Rename file" }).click();
  const input = studio.getByRole("textbox", { name: "File name" });
  await input.fill(to);
  await input.press("Enter");
  return studio;
}

test.describe("renaming a gallery file", () => {
  test("moves the bytes, renames the entry and rewrites every field naming it, rich text included", async ({
    page,
    request,
  }) => {
    await openStudio(
      page,
      `/val/~${GALLERY}?p=${encodeURIComponent(JSON.stringify(RED))}`,
    );
    const studio = page.locator("#val-shadow-root");
    await expect(
      studio.getByRole("button", { name: "Rename file" }),
    ).toBeVisible({ timeout: 30_000 });

    // Two referrers: a gallery-backed field, and an image inside rich text —
    // the one a scan for image fields alone walks straight past.
    await patchThroughStore(page, FIELDS, [
      { op: "replace", path: ["fromGallery"], value: { path: RED } },
      {
        op: "replace",
        path: ["richTextFromGallery"],
        value: [
          {
            tag: "p",
            children: ["Before ", { tag: "img", src: { path: RED } }],
          },
        ],
      },
    ]);
    await expect(
      studio.getByText("Renaming updates the 2 places using it."),
    ).toBeVisible({ timeout: 30_000 });

    await rename(page, "Crimson");

    // The entry moved.
    await expect
      .poll(() => serverKeys(request, GALLERY), { timeout: 30_000 })
      .toEqual([RENAMED]);
    // Both referrers follow it.
    await expect
      .poll(async () => {
        const fields = (await serverSource(request, FIELDS)) as {
          fromGallery: { path: string } | null;
          richTextFromGallery:
            | { children: (string | { src: { path: string } })[] }[]
            | null;
        };
        const img = fields.richTextFromGallery?.[0]?.children[1];
        return [
          fields.fromGallery?.path,
          typeof img === "object" ? img.src.path : img,
        ];
      })
      .toEqual([RENAMED, RENAMED]);
    // The bytes were copied to the new path and the old file is deleted.
    expect(await serverFileOps(request)).toEqual([
      [RENAMED, true],
      [RED, false],
    ]);
    // The dialog follows the file to its new name.
    await expect
      .poll(() => new URL(page.url()).searchParams.get("p"))
      .toBe(JSON.stringify(RENAMED));
    await expect(studio.getByText("crimson_bfbd0.png").first()).toBeVisible();

    // And the renamed file is really there: decoded, from the patch.
    const tile = studio.locator('img[src*="crimson_bfbd0"]').first();
    await expect(tile).toHaveAttribute("src", /\/api\/val\/files\/.*patch_id=/);
    await expect
      .poll(() => tile.evaluate((i) => (i as HTMLImageElement).naturalWidth), {
        timeout: 30_000,
        message: "the renamed file did not decode",
      })
      .toBe(8);

    await discardAll(page);
    await expectNoPatchesOnServer(request);
  });

  test("refuses a name with nothing usable in it, and changes nothing", async ({
    page,
    request,
  }) => {
    await openStudio(
      page,
      `/val/~${GALLERY}?p=${encodeURIComponent(JSON.stringify(RED))}`,
    );
    const studio = await rename(page, "øøø");
    await expect(studio.getByRole("alert")).toContainText(
      "no letters or digits",
    );
    expect(await serverKeys(request, GALLERY)).toEqual([RED]);
    expect(await serverFileOps(request)).toEqual([]);
    await expectNoPatchesOnServer(request);
  });
});

test.describe("renaming the file of a single field", () => {
  test("renames a draft upload, and it still decodes", async ({
    page,
    request,
  }) => {
    await openStudio(page, `/val/~${FIELDS}?p=%22image%22`);
    const studio = page.locator("#val-shadow-root");
    await studio
      .locator('input[type="file"]:not([multiple])')
      .first()
      .setInputFiles(IMAGE);
    await expect
      .poll(() => serverFileOps(request), { timeout: 30_000 })
      .toEqual([["/public/val/blue-8x8_8b441.png", true]]);

    await studio.getByRole("button", { name: "Rename", exact: true }).click();
    const input = studio.getByRole("textbox", { name: "File name" });
    await expect(input).toHaveValue("blue-8x8");
    // Focused on open: an editor types straight away.
    await expect(input).toBeFocused();
    await input.fill("sky");
    await input.press("Enter");

    await expect
      .poll(
        async () => {
          const fields = (await serverSource(request, FIELDS)) as {
            image: { path: string } | null;
          };
          return fields.image?.path;
        },
        { timeout: 30_000 },
      )
      .toBe("/public/val/sky_8b441.png");
    expect(await serverFileOps(request)).toEqual([
      ["/public/val/blue-8x8_8b441.png", true],
      ["/public/val/sky_8b441.png", true],
      ["/public/val/blue-8x8_8b441.png", false],
    ]);
    const img = studio.locator('img[src*="sky_8b441"]').first();
    await expect
      .poll(() => img.evaluate((i) => (i as HTMLImageElement).naturalWidth), {
        timeout: 30_000,
        message: "the renamed file did not decode",
      })
      .toBe(8);

    await discardAll(page);
    await expectNoPatchesOnServer(request);
  });

  test("a gallery-backed field sends you to the gallery instead", async ({
    page,
  }) => {
    await openStudio(page, `/val/~${FIELDS}?p=%22fromGallery%22`);
    const studio = page.locator("#val-shadow-root");
    await patchThroughStore(page, FIELDS, [
      { op: "replace", path: ["fromGallery"], value: { path: RED } },
    ]);
    await studio
      .getByRole("button", { name: "Rename", exact: true })
      .first()
      .click();
    await studio.getByRole("button", { name: /Open in/ }).click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("p"))
      .toBe(JSON.stringify(RED));
    await expect(page).toHaveURL(new RegExp(GALLERY.replace(/\./g, "\\.")));
  });
});
