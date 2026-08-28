import { initVal, type PatchId } from "@valbuild/core";
import { createSystem } from "./createSystem";

/**
 * `GET /patches` failing as a request, rather than per patch.
 *
 * The case that produced this: a chain of a few hundred pending patches put one
 * `patch_id` per id in the query string, and the request was refused before it
 * reached the handler — 431 from Node's 16KB header cap, 413 from a proxy in
 * front of it. `chunkPatchIds` stops building that URL, but every other way
 * of failing this request still exists (offline, a 500, a proxy), and what made
 * the original hard to place was that nothing said anything: stat named the
 * patches, their ops never arrived, and the editor rendered published content
 * for the fields they touched. Indistinguishable, on screen, from the edits
 * having been thrown away.
 *
 * So the request failing has to reach the user, and the patches must not be
 * concluded gone.
 */
const module = () => {
  const { c, s } = initVal();
  return c.define("/t.val.ts", s.object({ title: s.string() }), {
    title: "published",
  });
};

function systemWithFailingFetch(message: string) {
  const failures: PatchId[][] = [];
  const system = createSystem({
    fetchPatches: async (patchIds) => {
      failures.push(patchIds);
      // What the real seam returns for a failed REQUEST: `errors` naming every
      // id, so nothing concludes they are gone, plus one `error` for the request
      // itself.
      return {
        patches: [],
        errors: Object.fromEntries(patchIds.map((id) => [id, message])),
        error: message,
      };
    },
    createPatchId: () => "unused" as PatchId,
  });
  system.host.receive([module()]);
  return { system, failures };
}

/** The fetch is fired from a stat, so the report lands a tick or two later. */
async function settle() {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("a patch fetch that fails as a request", () => {
  it("tells the user, and keeps the patches in the chain", async () => {
    const { system } = systemWithFailingFetch("Request too large.");
    system.stat.receiveStat({
      patches: ["p1" as PatchId],
      baseSha: "sha",
    });
    await settle();

    const errors = system.status.current().errors;
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe("Unpublished changes could not be loaded.");
    expect(errors[0].details).toContain("Request too large.");
    // Announced and still expected, not dropped: a request that failed is
    // evidence of nothing, and dropping on it would take a real edit off screen.
    expect(system.patchStore.currentHead()).toMatchObject({
      // Still the head of the chain, and marked as having failed rather than
      // removed: a request that failed is evidence of nothing, and dropping on
      // it would take a real edit off screen.
      patchId: "p1",
      type: "external-failed",
    });

    system.dispose();
  });

  it("says it once, however many times the fetch fails", async () => {
    const { system } = systemWithFailingFetch("Failed to fetch");
    for (let i = 0; i < 3; i++) {
      system.stat.receiveStat({
        patches: [`p${i}` as PatchId],
        baseSha: "sha",
      });
      await settle();
    }
    // De-duplicated by message in `StatusStore`, so a failing retry loop is one
    // thing to say rather than a stack of identical toasts.
    expect(system.status.current().errors).toHaveLength(1);
    system.dispose();
  });

  it("reports an id TWO stats named that the fetch did not return", async () => {
    /*
     * This case USED to assert silence, on the reading that an id absent from
     * the result is how a deleted patch is observed.
     *
     * That reading is what let the production failure hide: a studio told about
     * 410 unpublished changes, sent 359, and left waiting on the rest with
     * nothing said. Deletion is observed by stat no longer NAMING an id — see
     * "still treats a change stat stopped naming as deleted" in
     * `announcedNotDelivered.test.ts`. Stat naming an id whose ops never arrive
     * is the opposite: the person is editing on top of content that is missing.
     *
     * What it takes TWO stats for is in `PatchStore.notDeliveredOnce`: the first
     * announcement can simply be older than a delete, and a stat issued after
     * the delete is the only thing that can tell that from a server that cannot
     * send what it has.
     */
    const system = createSystem({
      fetchPatches: async () => ({ patches: [] }),
      createPatchId: () => "unused" as PatchId,
    });
    system.host.receive([module()]);
    system.stat.receiveStat({ patches: ["gone" as PatchId], baseSha: "sha" });
    await settle();
    expect(system.status.current().errors).toHaveLength(0);

    system.stat.receiveStat({ patches: ["gone" as PatchId], baseSha: "sha" });
    await settle();
    expect(system.status.current().errors).toHaveLength(1);
    expect(system.status.current().errors[0].message).toBe(
      "An unpublished change could not be loaded.",
    );
    system.dispose();
  });

  /**
   * The wait is not a silence with nothing behind it: the id is out of
   * `fetching`, so the next stat that still names it asks again. That retry is
   * the whole reason one empty answer can be treated as inconclusive.
   */
  it("asks again for an id the first fetch did not return", async () => {
    const asked: PatchId[][] = [];
    const system = createSystem({
      fetchPatches: async (patchIds) => {
        asked.push([...patchIds]);
        return { patches: [] };
      },
      createPatchId: () => "unused" as PatchId,
    });
    system.host.receive([module()]);
    system.stat.receiveStat({ patches: ["gone" as PatchId], baseSha: "sha" });
    await settle();
    system.stat.receiveStat({ patches: ["gone" as PatchId], baseSha: "sha" });
    await settle();

    expect(asked).toEqual([["gone"], ["gone"]]);
    system.dispose();
  });
});
