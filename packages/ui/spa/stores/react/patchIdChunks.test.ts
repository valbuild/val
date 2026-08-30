import type { PatchId } from "@valbuild/core";
import {
  chunkPatchIds,
  PATCH_ID_QUERY_BUDGET,
  patchIdsPerRequest,
} from "./patchIdChunks";

/**
 * Real-shaped uuids: 36 characters is what the budget is reasoned about, so a
 * budget assertion against short ids would prove nothing.
 */
const ids = (n: number): PatchId[] =>
  Array.from({ length: n }, (_, i) => {
    const id =
      `${i.toString().padStart(8, "0")}-0000-4000-8000-000000000000` as PatchId;
    expect(id.length).toBe(36);
    return id;
  });

/** Every param the two endpoints repeat ids under. */
const PARAMS = ["patch_id", "id"] as const;

/**
 * `GET /patches` takes its ids as repeated `patch_id` params and `DELETE
 * /patches` as repeated `id` params, and nothing bounded how many. A project
 * with 650 pending changes put all of them on one URL, and the request never
 * reached the handler — 431 from Node's request-head cap, 413 from a proxy in
 * front of it.
 *
 * These two used to be separate functions with budgets 4x apart, implying two
 * different limits existed. One splitter now, one budget, and the only thing
 * that differs is the param name.
 */
describe("chunkPatchIds", () => {
  describe.each(PARAMS)("&%s=", (paramName) => {
    const cost = (id: string) => `&${paramName}=`.length + id.length;

    it("keeps every id, once, in order", () => {
      const all = ids(650);
      expect(chunkPatchIds(all, paramName).flat()).toEqual(all);
    });

    it("splits a list that would not fit on one URL", () => {
      expect(chunkPatchIds(ids(650), paramName).length).toBeGreaterThan(1);
    });

    it("sends a list that fits as a single request", () => {
      expect(
        chunkPatchIds(ids(patchIdsPerRequest(paramName)), paramName),
      ).toHaveLength(1);
    });

    /** The property the whole file exists for, asserted rather than assumed. */
    it("keeps every chunk's query string inside the budget", () => {
      for (const chunk of chunkPatchIds(ids(1000), paramName)) {
        const queryLength = chunk.reduce((total, id) => total + cost(id), 0);
        expect(queryLength).toBeLessThanOrEqual(PATCH_ID_QUERY_BUDGET);
      }
    });

    it("asks for nothing when there is nothing to ask for", () => {
      // Not one empty request: an unfiltered `GET /patches` answers with the
      // whole table, and `DELETE /patches` requires at least one id.
      expect(chunkPatchIds([], paramName)).toEqual([]);
    });
  });

  /**
   * The two endpoints spend the same budget on differently-priced ids, so the
   * cheaper param fits more. That is the whole reason the cost is derived from
   * the param name rather than hardcoded once.
   */
  it("fits more ids under the shorter param name", () => {
    expect(patchIdsPerRequest("id")).toBeGreaterThan(
      patchIdsPerRequest("patch_id"),
    );
  });

  it("sends at least one id per request however long the param name", () => {
    // Never zero: a chunk size of 0 would loop forever rather than fail.
    expect(patchIdsPerRequest("a".repeat(PATCH_ID_QUERY_BUDGET))).toBe(1);
  });

  /**
   * The URL an e2e run actually sees. `e2e/large-patch-chain.spec.ts` asserts
   * `request.url.length < 4000` on a 650-patch chain, which the budget this
   * replaced (6000, aimed at Node's 16KB rather than at the URL) would not have
   * satisfied.
   */
  it("leaves room for the rest of the URL", () => {
    const base =
      "http://localhost:3000/api/val/patches?exclude_patch_ops=false";
    for (const chunk of chunkPatchIds(ids(650), "patch_id")) {
      const url = base + chunk.map((id) => `&patch_id=${id}`).join("");
      expect(url.length).toBeLessThan(2000);
    }
  });
});
