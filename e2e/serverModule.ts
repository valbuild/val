import { expect, type APIRequestContext } from "@playwright/test";

/**
 * One module as the SERVER has it now, every pending patch applied: what the
 * specs assert on when the question is what was saved, not what the Studio
 * shows. Read through `GET /api/val/modules/~<path>`, the endpoint the
 * Studio itself loads modules through (`originTier`).
 *
 * `source` has the `.jsonValues()` entries the chain touched filled in, so it
 * reads like the module would after a publish; an entry nobody edited stays
 * a marker. `patches` is the ids of the patches the version is made of, in
 * chain order: empty for a module that is its build's own.
 *
 * These specs used `PUT /api/val/sources/~`, the whole tree in one answer,
 * which went in the release after the one content model shipped.
 */
export async function serverModule(
  request: APIRequestContext,
  moduleFilePath: string,
): Promise<{ source: unknown; patches: string[] }> {
  const res = await request.get(`/api/val/modules/~${moduleFilePath}`);
  expect(res.status(), await res.text()).toBe(200);
  const body: unknown = await res.json();
  if (
    typeof body !== "object" ||
    body === null ||
    Reflect.get(body, "kind") !== "module"
  ) {
    throw new Error(`not a module answer: ${JSON.stringify(body)}`);
  }
  const source: unknown = Reflect.get(body, "source");
  const entries: unknown = Reflect.get(body, "entries");
  const patches: unknown = Reflect.get(body, "patches");
  return {
    source: withEntries(source, entries),
    patches: Array.isArray(patches)
      ? patches.filter((id): id is string => typeof id === "string")
      : [],
  };
}

/** One module's source, as {@link serverModule} reads it. */
export async function serverSource(
  request: APIRequestContext,
  moduleFilePath: string,
): Promise<unknown> {
  return (await serverModule(request, moduleFilePath)).source;
}

function withEntries(source: unknown, entries: unknown): unknown {
  if (
    typeof source !== "object" ||
    source === null ||
    Array.isArray(source) ||
    typeof entries !== "object" ||
    entries === null
  ) {
    return source;
  }
  const filled: Record<string, unknown> = { ...source };
  for (const [key, entry] of Object.entries(entries)) {
    if (typeof entry !== "object" || entry === null) continue;
    if ("content" in entry) {
      filled[key] = entry.content;
    } else if ("deleted" in entry) {
      delete filled[key];
    }
  }
  return filled;
}
