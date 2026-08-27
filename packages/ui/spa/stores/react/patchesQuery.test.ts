import type { PatchId } from "@valbuild/core";
import {
  chunkPatchIdsForDelete,
  PATCH_ID_QUERY_BUDGET,
  planPatchIdQuery,
} from "./patchesQuery";

/** Real-shaped uuids: 36 characters is what the budget is reasoned about. */
const ids = (n: number): PatchId[] =>
  Array.from({ length: n }, (_, i) => {
    const id =
      `${i.toString().padStart(8, "0")}-0000-4000-8000-000000000000` as PatchId;
    expect(id.length).toBe(36);
    return id;
  });

describe("planPatchIdQuery", () => {
  test("asks for exactly the ids it wants, while they fit", () => {
    expect(planPatchIdQuery(ids(3))).toEqual(ids(3));
  });

  test("asks for nothing when it wants nothing", () => {
    // An unfiltered request here would return the whole table to a caller that
    // asked for none of it.
    expect(planPatchIdQuery([])).toEqual([]);
  });

  /**
   * The bug: 650 pending patches made a 30KB URL, which Node refused with 431
   * before the handler ever saw it.
   */
  test("drops the filter rather than build a URL nothing will accept", () => {
    expect(planPatchIdQuery(ids(650))).toBeUndefined();
  });

  test("every plan it does send fits the budget", () => {
    for (const n of [1, 10, 32, 33, 34, 100]) {
      const plan = planPatchIdQuery(ids(n));
      if (plan === undefined) continue;
      const query = plan.map((id) => `&patch_id=${id}`).join("");
      expect(query.length).toBeLessThanOrEqual(PATCH_ID_QUERY_BUDGET);
    }
  });

  test("the switch is monotonic: more ids never brings the filter back", () => {
    let dropped = false;
    for (let n = 1; n <= 200; n++) {
      const plan = planPatchIdQuery(ids(n));
      if (plan === undefined) {
        dropped = true;
      } else if (dropped) {
        throw new Error(`asked for ${n} ids after dropping the filter`);
      }
    }
    expect(dropped).toBe(true);
  });
});

describe("chunkPatchIdsForDelete", () => {
  test("one request while the ids fit", () => {
    expect(chunkPatchIdsForDelete(ids(5))).toEqual([ids(5)]);
  });

  test("no request for no ids", () => {
    expect(chunkPatchIdsForDelete([])).toEqual([]);
  });

  /** "Discard all" on the chain that produced the bug. */
  test("splits a long chain, losing nothing and repeating nothing", () => {
    const all = ids(650);
    const chunks = chunkPatchIdsForDelete(all);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flat()).toEqual(all);
    for (const chunk of chunks) {
      const query = chunk.map((id) => `&id=${id}`).join("");
      expect(query.length).toBeLessThanOrEqual(PATCH_ID_QUERY_BUDGET);
    }
  });
});
