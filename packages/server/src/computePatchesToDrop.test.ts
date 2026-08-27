import { ModuleFilePath, PatchId } from "@valbuild/core";
import { computePatchesToDrop } from "./computePatchesToDrop";

const A = "/a.val.ts" as ModuleFilePath;
const B = "/b.val.ts" as ModuleFilePath;
const id = (n: string): PatchId => n as PatchId;

/**
 * What a failed save throws away so the next one can succeed.
 *
 * `/save` used to refuse the whole commit on any unappliable patch, which under
 * auto-save is a dead stop: the same patch fails every time and nothing is ever
 * written again.
 */
describe("computePatchesToDrop", () => {
  it("drops nothing when nothing failed", () => {
    expect(
      computePatchesToDrop({
        triedPatches: {},
        skippedPatches: {},
        unappliablePatches: {},
      }),
    ).toEqual([]);
  });

  it("drops the change that failed, with the reason it failed", () => {
    const dropped = computePatchesToDrop({
      triedPatches: { [A]: [id("p2")] },
      skippedPatches: {},
      unappliablePatches: {
        [id("p2")]: { moduleFilePath: A, message: "Array index out of bounds" },
      },
    });

    expect(dropped).toEqual([
      {
        patchId: "p2",
        moduleFilePath: A,
        message: "Array index out of bounds",
      },
    ]);
  });

  /**
   * The rule the whole thing turns on: a patch is ops against the source as the
   * patches before it left it, so once one has not been applied the ones after
   * it were written against a state that never existed.
   */
  it("takes the rest of that module's chain with it", () => {
    const dropped = computePatchesToDrop({
      triedPatches: { [A]: [id("p2")] },
      skippedPatches: { [A]: [id("p3"), id("p4")] },
      unappliablePatches: {
        [id("p2")]: { moduleFilePath: A, message: "no such index" },
      },
    });

    expect(dropped.map((entry) => entry.patchId)).toEqual(["p2", "p3", "p4"]);
  });

  it("says which of them actually failed and which merely followed one", () => {
    const dropped = computePatchesToDrop({
      triedPatches: { [A]: [id("p2")] },
      skippedPatches: { [A]: [id("p3")] },
      unappliablePatches: {
        [id("p2")]: { moduleFilePath: A, message: "no such index" },
      },
    });

    // Two different things to be told, and only the first is a bug in the
    // change itself.
    expect(dropped[0].message).toBe("no such index");
    expect(dropped[1].message).toContain("An earlier change to /a.val.ts");
  });

  /**
   * `prepare` walks each module's chain on its own, so a broken chain in one
   * file says nothing about another. Dropping more would throw away work for no
   * reason.
   */
  it("leaves other modules alone", () => {
    const dropped = computePatchesToDrop({
      triedPatches: { [A]: [id("a2")] },
      skippedPatches: { [A]: [id("a3")], [B]: [] },
      unappliablePatches: {
        [id("a2")]: { moduleFilePath: A, message: "broken" },
      },
    });

    expect(dropped.map((entry) => entry.patchId).sort()).toEqual(["a2", "a3"]);
  });

  it("drops from the first failure in each module independently", () => {
    const dropped = computePatchesToDrop({
      triedPatches: { [A]: [id("a2")], [B]: [id("b1")] },
      skippedPatches: { [A]: [id("a3")], [B]: [] },
      unappliablePatches: {
        [id("a2")]: { moduleFilePath: A, message: "broken a" },
        [id("b1")]: { moduleFilePath: B, message: "broken b" },
      },
    });

    expect(dropped.map((entry) => entry.patchId).sort()).toEqual([
      "a2",
      "a3",
      "b1",
    ]);
  });

  it("names a change once, however many lists hold it", () => {
    const dropped = computePatchesToDrop({
      triedPatches: { [A]: [id("p1")] },
      skippedPatches: { [A]: [id("p1")] },
      unappliablePatches: {
        [id("p1")]: { moduleFilePath: A, message: "broken" },
      },
    });

    expect(dropped).toHaveLength(1);
  });

  /**
   * A patch reported unappliable that neither list holds would otherwise be left
   * behind to fail the next save the same way — the dead stop this exists to
   * prevent, reintroduced by an inconsistency rather than by design.
   */
  it("still drops a change reported unappliable and listed nowhere", () => {
    const dropped = computePatchesToDrop({
      triedPatches: {},
      skippedPatches: {},
      unappliablePatches: {
        [id("orphan")]: { moduleFilePath: B, message: "somehow" },
      },
    });

    expect(dropped).toEqual([
      { patchId: "orphan", moduleFilePath: B, message: "somehow" },
    ]);
  });
});
