import { initVal, type ModuleFilePath, type PatchId } from "@valbuild/core";
import { createSystem, type System } from "./createSystem";
import type { PublishOutcome } from "./PublishSeam";
import { mfp, sp } from "./testSystem";

/**
 * Publish and discard, and the difference between them.
 *
 * They look symmetrical and are not. A DISCARDED patch was thrown away, so its
 * effect must disappear: source is rebuilt from base plus what survives. A
 * PUBLISHED patch's effect must stay, because it is in the base now — rebuilding
 * would be right only once the base has been refetched, and until then it reverts
 * every published field on screen.
 *
 * That distinction is invisible in a test that only checks the network call, which
 * is why these tests are about what the SOURCE shows afterwards.
 */
const project = () => {
  const { c, s } = initVal();
  return [
    c.define("/a.val.ts", s.object({ title: s.string().minLength(2) }), {
      title: "original",
    }),
    c.define("/b.val.ts", s.object({ title: s.string() }), { title: "other" }),
  ];
};

function makeSystem(
  outcome: PublishOutcome = { status: "published" },
  options?: { mode?: "fs" | "http"; discard?: PatchId[] },
): {
  system: System;
  publishes: { patchIds: PatchId[]; message?: string }[];
  discards: PatchId[][];
} {
  const publishes: { patchIds: PatchId[]; message?: string }[] = [];
  const discards: PatchId[][] = [];
  const system = createSystem({
    fetchPatches: async () => ({ patches: [] }),
    createPatchId: (() => {
      let next = 0;
      return () => `pub-${++next}` as PatchId;
    })(),
    mode: options?.mode,
    publishPatches: async (request) => {
      publishes.push(request);
      return outcome;
    },
    discardPatches: async (patchIds) => {
      discards.push(patchIds);
      return {
        status: "discarded",
        patchIds: options?.discard ?? patchIds,
      };
    },
  });
  system.host.receive(project());
  return { system, publishes, discards };
}

const edit = (system: System, value: string, module = "/a.val.ts") =>
  system.patchStore.createPatch(module as ModuleFilePath, [
    { op: "replace", path: ["title"], value },
  ]);

describe("publish", () => {
  it("keeps showing the published value after the chain is gone", async () => {
    const { system, publishes } = makeSystem();
    const patch = await edit(system, "published value");
    expect(patch.status === "created" && patch.record.patchId).toBeTruthy();
    const patchId = patch.status === "created" ? patch.record.patchId : null;

    const res = await system.publish([patchId as PatchId]);

    expect(res).toMatchObject({ status: "published" });
    expect(publishes).toEqual([{ patchIds: [patchId], message: undefined }]);
    // THE assertion. The patch is out of the chain — and the value is unchanged,
    // because the patched source was promoted to base first. Reverse that order
    // and this reads "original", which is what an editor would see flash back.
    expect(system.patchStore.allRecords()).toEqual([]);
    expect(system.sourceStore.peek(sp('/a.val.ts?p="title"'))).toMatchObject({
      status: "ready",
      data: "published value",
    });
    system.dispose();
  });

  /**
   * And it must not repaint. Promoting the base does not change the VALUE, so a
   * revision bump would wake every field to tell it nothing happened.
   */
  it("does not move the revision", async () => {
    const { system } = await Promise.resolve(makeSystem());
    const patch = await edit(system, "published value");
    const patchId = patch.status === "created" ? patch.record.patchId : null;
    const before = system.sourceStore.revisionOf(mfp("/a.val.ts"));

    await system.publish([patchId as PatchId]);

    expect(system.sourceStore.revisionOf(mfp("/a.val.ts"))).toEqual(before);
    system.dispose();
  });

  /**
   * In `http` mode the server keeps the patches and re-applies them, so the chain
   * has to stay. Dropping it would show the value without them until the next
   * fetch, and promoting the base would then count them twice.
   */
  it("leaves the chain alone in http mode", async () => {
    const { system } = makeSystem({ status: "published" }, { mode: "http" });
    const patch = await edit(system, "published value");
    const patchId = patch.status === "created" ? patch.record.patchId : null;

    await system.publish([patchId as PatchId]);

    expect(system.patchStore.allRecords()).toHaveLength(1);
    expect(system.sourceStore.peek(sp('/a.val.ts?p="title"'))).toMatchObject({
      data: "published value",
    });
    system.dispose();
  });

  /**
   * The gate. A publish blocked by validation errors is the system working, so it
   * is `refused` rather than `failed`, and it names the modules — a UI that can
   * only say no is worse than one that can take the editor to the problem.
   */
  it("refuses to publish a module with validation errors", async () => {
    const { system, publishes } = makeSystem();
    // `minLength(2)`, so one character is invalid.
    const patch = await edit(system, "x");
    const patchId = patch.status === "created" ? patch.record.patchId : null;

    const res = await system.publish([patchId as PatchId]);

    expect(res).toMatchObject({
      status: "refused",
      reason: "validation-errors",
      modules: ["/a.val.ts"],
    });
    // And nothing was sent. A gate that reports refusal after publishing is not a
    // gate.
    expect(publishes).toEqual([]);
    expect(system.patchStore.allRecords()).toHaveLength(1);
    system.dispose();
  });

  it("says nothing-to-publish rather than sending an empty request", async () => {
    const { system, publishes } = makeSystem();
    expect(await system.publish([])).toMatchObject({
      status: "nothing-to-publish",
    });
    expect(publishes).toEqual([]);
    system.dispose();
  });

  /**
   * A 409 is someone else committing first — retryable once this client catches
   * up. A per-patch 400 is not, and carries which patches: "failed to publish"
   * with no way to find the offending change is what this replaces.
   */
  it("marks a not-fast-forward retryable and keeps the chain", async () => {
    const { system } = makeSystem({
      status: "not-fast-forward",
      message: "someone else committed",
    });
    const patch = await edit(system, "published value");
    const patchId = patch.status === "created" ? patch.record.patchId : null;

    const res = await system.publish([patchId as PatchId]);

    expect(res).toMatchObject({ status: "failed", retryable: true });
    expect(system.patchStore.allRecords()).toHaveLength(1);
    system.dispose();
  });

  it("carries per-patch errors and does not retry them", async () => {
    const { system } = makeSystem({
      status: "patch-errors",
      message: "2 changes cannot be applied",
      errors: { ["pub-1" as PatchId]: "cannot apply to the AST" },
    });
    const patch = await edit(system, "published value");
    const patchId = patch.status === "created" ? patch.record.patchId : null;

    const res = await system.publish([patchId as PatchId]);

    expect(res).toMatchObject({
      status: "failed",
      retryable: false,
      patchErrors: { "pub-1": "cannot apply to the AST" },
    });
    system.dispose();
  });
});

describe("discard", () => {
  /**
   * The opposite of publish, and this is the assertion that shows it: the value
   * goes BACK. An applied patch cannot be un-applied, so this can only be right if
   * source was rebuilt from base plus the surviving chain.
   */
  it("takes the value back", async () => {
    const { system, discards } = makeSystem();
    const patch = await edit(system, "will be discarded");
    const patchId = patch.status === "created" ? patch.record.patchId : null;
    expect(system.sourceStore.peek(sp('/a.val.ts?p="title"'))).toMatchObject({
      data: "will be discarded",
    });

    const res = await system.discard([patchId as PatchId]);

    expect(res).toMatchObject({ status: "discarded" });
    expect(discards).toEqual([[patchId]]);
    expect(system.sourceStore.peek(sp('/a.val.ts?p="title"'))).toMatchObject({
      data: "original",
    });
    expect(system.patchStore.allRecords()).toEqual([]);
    system.dispose();
  });

  /**
   * The ids the SERVER says it deleted, not the ids we asked about. A partial
   * delete must not make the client forget a patch that still exists — it would
   * then be published later by something the client no longer knows about.
   */
  it("forgets only what the server deleted", async () => {
    const { system } = makeSystem({ status: "published" }, { discard: [] });
    const patch = await edit(system, "survives");
    const patchId = patch.status === "created" ? patch.record.patchId : null;

    await system.discard([patchId as PatchId]);

    expect(system.patchStore.allRecords()).toHaveLength(1);
    expect(system.sourceStore.peek(sp('/a.val.ts?p="title"'))).toMatchObject({
      data: "survives",
    });
    system.dispose();
  });
});
