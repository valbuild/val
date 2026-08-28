import type { PatchId } from "@valbuild/core";
import { chunkPatchIds, PATCH_IDS_PER_REQUEST } from "./patchIdChunks";

const ids = (count: number): PatchId[] =>
  Array.from({ length: count }, (_, i) => `patch-${i}` as PatchId);

/**
 * `GET /patches` takes its ids as repeated query params, and nothing bounded how
 * many. A project with 410 pending changes asked for all of them on one URL:
 * ~19KB of request line, past the 16KB a Node server accepts, so the dev server
 * refused it before the handler ran and the studio marked every pending change
 * failed.
 */
describe("chunkPatchIds", () => {
  it("keeps every id, once, in order", () => {
    const all = ids(410);
    expect(chunkPatchIds(all).flat()).toEqual(all);
  });

  it("splits a list that would not fit on one URL", () => {
    expect(chunkPatchIds(ids(410)).length).toBeGreaterThan(1);
  });

  it("sends a list that fits as a single request", () => {
    expect(chunkPatchIds(ids(PATCH_IDS_PER_REQUEST))).toHaveLength(1);
  });

  it("keeps every chunk's query string well inside what a server accepts", () => {
    // The real constraint, asserted rather than assumed: a uuid is 36 chars and
    // each one costs `&patch_id=` on top.
    for (const chunk of chunkPatchIds(ids(1000))) {
      const queryLength = chunk.reduce(
        (total, id) => total + "&patch_id=".length + Math.max(id.length, 36),
        0,
      );
      expect(queryLength).toBeLessThan(8000);
    }
  });

  it("asks for nothing when there is nothing to ask for", () => {
    // Not one empty request: an unfiltered `GET /patches` answers with the whole
    // table, so sending an empty chunk would pull every patch in the project.
    expect(chunkPatchIds([])).toEqual([]);
  });
});
