import type { Json, ModuleFilePath, SerializedSchema } from "@valbuild/core";
import { buildSearchIndex, performSearch } from "./searchIndex";

/**
 * The claim the MCP `search_content` tool rests on: a large project indexes in
 * seconds, so the index can be built per call and thrown away.
 *
 * Measured against a real production site (`valbuild/web`, 20 modules and
 * 206 KB of source JSON) that indexes in 162 ms, and scaling linearly from
 * there. This builds a corpus an order of magnitude larger than that site and
 * asserts it still finishes inside the tool's default 10 s deadline.
 *
 * The bound is deliberately far above the measured cost (~1.4 s for this size
 * on a 4-cpu container). It is not a stopwatch on CI's hardware — it is a guard
 * against the index going super-linear, which is the change that would turn
 * "build it every time" from cheap into wrong. A quadratic regression at this
 * size is hundreds of times over, not twice.
 */

const MODULES = 200;
const FIELDS_PER_MODULE = 40;
/** The tool's default. Reaching it is the failure this test is about. */
const DEFAULT_SEARCH_TIMEOUT_MS = 10_000;

const WORDS = [
  "content",
  "editor",
  "gallery",
  "publish",
  "schema",
  "module",
  "richtext",
  "paragraph",
  "heading",
  "reference",
];

function sentence(seed: number, length: number): string {
  const out: string[] = [];
  for (let i = 0; i < length; i++) {
    out.push(WORDS[(seed + i) % WORDS.length]);
  }
  return out.join(" ");
}

function corpus(): Record<
  ModuleFilePath,
  { source: Json; schema: SerializedSchema }
> {
  const out: Record<
    ModuleFilePath,
    { source: Json; schema: SerializedSchema }
  > = {};
  for (let m = 0; m < MODULES; m++) {
    const source: Record<string, Json> = {};
    const items: Record<string, SerializedSchema> = {};
    for (let f = 0; f < FIELDS_PER_MODULE; f++) {
      source[`field${f}`] = sentence(m + f, 40);
      items[`field${f}`] = { type: "string", opt: false, raw: false };
    }
    out[`/content/module${m}.val.ts` as ModuleFilePath] = {
      source,
      schema: { type: "object", opt: false, items },
    };
  }
  return out;
}

describe("indexing a large project", () => {
  // The jest timeout is set above the assertion on purpose, so a slow machine
  // reports the measured number rather than dying on jest's own 5 s default
  // with nothing to show.
  const JEST_TIMEOUT_MS = 60_000;

  it(
    "finishes well inside the search tool's default deadline",
    () => {
      const modules = corpus();
      const bytes = Object.values(modules).reduce(
        (total, m) => total + JSON.stringify(m.source).length,
        0,
      );
      // Sanity: a corpus that shrank to nothing would pass the timing
      // assertion while testing nothing at all.
      expect(bytes).toBeGreaterThan(1_000_000);

      const start = Date.now();
      const index = buildSearchIndex(modules);
      const buildMs = Date.now() - start;

      expect(buildMs).toBeLessThan(DEFAULT_SEARCH_TIMEOUT_MS);

      // And the index is real: an empty one would also build instantly.
      expect(performSearch(index, "richtext", 5).total).toBeGreaterThan(0);
    },
    JEST_TIMEOUT_MS,
  );
});
