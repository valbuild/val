import { expect, type APIRequestContext } from "@playwright/test";

/**
 * What the SERVER holds, read over HTTP — what these specs assert on.
 *
 * Not the Studio's store: an upload or a rename that only changed the
 * client's view would pass a store read and publish nothing. See
 * `e2e/README.md`.
 */

/** One module's source, every pending patch applied. */
export async function serverSource(
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
