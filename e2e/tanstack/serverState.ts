import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { serverSource } from "../serverModule";

export { serverSource };

/**
 * What the SERVER holds, read over HTTP — what these specs assert on.
 *
 * Not the Studio's store: an upload or a rename that only changed the
 * client's view would pass a store read and publish nothing. See
 * `e2e/README.md`.
 */

/** The value at `key` of a module whose source is an object. */
export async function serverField(
  request: APIRequestContext,
  moduleFilePath: string,
  key: string,
): Promise<unknown> {
  const source = await serverSource(request, moduleFilePath);
  return typeof source === "object" && source !== null
    ? Reflect.get(source, key)
    : source;
}

/** Every `file` op the server holds: what was uploaded, and what deleted. */
export async function serverFileOps(
  request: APIRequestContext,
): Promise<{ filePath: string; deleted: boolean; patchId: string }[]> {
  const res = await request.get("/api/val/patches");
  expect(res.ok(), `the server refused the request: ${res.status()}`).toBe(
    true,
  );
  const body = (await res.json()) as {
    patches: {
      patchId: string;
      patch?: { op: string; filePath?: string; value?: unknown }[];
    }[];
  };
  return body.patches.flatMap((patch) =>
    (patch.patch ?? [])
      .filter((op) => op.op === "file" && typeof op.filePath === "string")
      .map((op) => ({
        filePath: op.filePath ?? "",
        deleted: op.value === null,
        patchId: patch.patchId,
      })),
  );
}

/**
 * Take WebCodecs away from the page, so a streaming upload takes the
 * fallback: the original file goes up and the Studio says why.
 *
 * Whether a browser can encode H.264 depends on how it was built — the
 * Chromium Playwright downloads cannot, the one on a CI runner can — so a
 * test about the fallback has to make it happen rather than assume it.
 * Not about the server, but every spec that uploads video needs it.
 */
export async function withoutWebCodecs(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Reflect.deleteProperty(globalThis, "VideoEncoder");
    Reflect.deleteProperty(globalThis, "VideoDecoder");
  });
}
