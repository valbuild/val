import type { PatchId } from "@valbuild/core";
import { StatStore } from "./StatStore";

/**
 * `noteHeadVersion` is our own save saying "the chain is at least here". A stat
 * that was still being PREPARED when it said so was read before the save, and
 * adopting it would rewind the list the save is already past.
 */
describe("the stat store's version floor", () => {
  it("drops a stat still being prepared when our own save overtakes it", async () => {
    const stat = new StatStore();
    let release: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    stat.setPreparer(() => ready.then(() => () => true));

    stat.receiveStat({
      patches: ["theirs" as PatchId],
      headPatchId: "theirs" as PatchId,
      headVersion: 1,
    });
    stat.noteHeadVersion(2);
    release();
    await ready;
    await Promise.resolve();

    expect(stat.currentPatchIds()).toEqual([]);
    expect(stat.currentHeadVersion()).toBeUndefined();
  });

  it("still adopts a prepared stat the floor has not passed", async () => {
    const stat = new StatStore();
    stat.setPreparer(() => Promise.resolve(() => true));

    stat.receiveStat({
      patches: ["theirs" as PatchId],
      headPatchId: "theirs" as PatchId,
      headVersion: 2,
    });
    stat.noteHeadVersion(2);
    await Promise.resolve();
    await Promise.resolve();

    expect(stat.currentPatchIds()).toEqual(["theirs"]);
    expect(stat.currentHeadVersion()).toBe(2);
  });
});
