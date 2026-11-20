import { expect, type Locator, type Page } from "@playwright/test";

/** Uploading to a gallery from a test, and reading back where it went. */

/** The gallery's picker — never the AI chat's, which is the `multiple` one. */
export function picker(studio: Locator): Locator {
  return studio.locator('input[type="file"]:not([multiple])');
}

/**
 * Wait until an upload can actually succeed, then hand over the file.
 *
 * A remote gallery cannot upload until `/remote/settings` has answered and a
 * bucket has been picked from it, which is several async hops after intake -
 * and `openHttpStudio` returns at intake. Setting the file before then makes
 * `handleUpload` refuse it AND clear the input (`ev.target.value = ""`), so the
 * upload never happens at all and the test fails 30s later polling for a ref
 * that was never going to appear. That is the flake this replaces; CI caught it
 * with `currentRemoteFileBucket: null, remoteFiles: { status: 'loading' }` -
 * the request still in flight.
 *
 * The wait is on the upload button being enabled rather than on the response,
 * because the button is downstream of BOTH the response and the effect that
 * picks a bucket. Waiting for the response alone would still leave a render to
 * race. It is also a boundary a person can see - the Studio does not offer the
 * control until it works - rather than a reach into the client's state.
 *
 * `setInputFiles` does NOT wait for this on its own: measured, it sets files on
 * a disabled input immediately, and the disabled input still fires `change`.
 * So the wait has to be explicit.
 */
export async function uploadWhenReady(
  studio: Locator,
  file: string,
): Promise<void> {
  await expect(
    studio.getByTitle("Upload file"),
    "the gallery never became ready to upload",
  ).toBeEnabled({ timeout: 30_000 });
  await picker(studio).first().setInputFiles(file);
}

/** Every `file` op path in the chain: where an upload decided to store itself. */
export function uploadedRefs(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const store = (
      window as unknown as {
        __VAL_STORES__: {
          system: {
            patchStore: {
              allRecords(): { patch: { op: string; filePath?: string }[] }[];
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
          .map((op) => op.filePath ?? ""),
      );
  });
}
