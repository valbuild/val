import { initVal, type ModuleFilePath, type PatchId } from "@valbuild/core";
import { createSystem, type System } from "./createSystem";

/**
 * What a DISCARD has to tell the content API besides "delete these".
 *
 * Deleting a patch out of the middle of a patch set leaves every group that
 * still holds the rest with a non-prefix intersection — and a prefix is the one
 * invariant a group has, because the patches after the hole were written
 * against a view that had it. The content API cannot work out which patches
 * those are: it has no schema, so it cannot compute patch sets. The client
 * sends the forward closure as `alsoUnstagePatchIds` and those lose their
 * membership everywhere without being deleted.
 *
 * Nothing here sent it. `home` has accepted the field since the patch-group
 * work landed there, so a discard silently left other authors holding a suffix
 * of a set, surfacing much later as a publish refusal naming raw patch ids.
 * Found by reading the two repos against each other rather than from either
 * side alone.
 */

const LIST = "/list.val.ts" as ModuleFilePath;
const OTHER = "/other.val.ts" as ModuleFilePath;

const project = () => {
  const { c, s } = initVal();
  return [
    c.define(LIST, s.object({ items: s.array(s.string()) }), {
      items: ["a", "b"],
    }),
    c.define(OTHER, s.object({ title: s.string() }), { title: "base" }),
  ];
};

function makeSystem(options?: { patchGroups?: boolean }) {
  const hasGroups = options?.patchGroups !== false;
  const discards: {
    patchIds: PatchId[];
    alsoUnstage: PatchId[] | undefined;
  }[] = [];
  const system = createSystem({
    fetchPatches: async () => ({ patches: [] }),
    createPatchId: (() => {
      let next = 0;
      return () => `p${++next}` as PatchId;
    })(),
    savePatches: async ({ patches, parentRef }) => ({
      status: "saved",
      newPatchIds: patches.map((patch) => patch.patchId),
      parentRef,
      // A deployment that HAS patch groups, which is the only place a discard
      // closure means anything — there are no memberships to repair otherwise.
      ...(hasGroups ? { patchGroupId: "g1" } : {}),
    }),
    publishPatches: async () => ({ status: "published" }),
    discardPatches: async (patchIds, alsoUnstagePatchIds) => {
      discards.push({
        patchIds: [...patchIds],
        alsoUnstage: alsoUnstagePatchIds && [...alsoUnstagePatchIds],
      });
      return { status: "discarded", patchIds };
    },
  });
  system.host.receive(project());
  system.stat.receiveStat({ patches: [], baseSha: "sha" });
  return { system, discards };
}

async function write(
  system: System,
  moduleFilePath: ModuleFilePath,
  patch: Parameters<System["patchStore"]["createPatch"]>[1],
): Promise<PatchId> {
  const res = await system.patchStore.createPatch(moduleFilePath, patch);
  if (res.status !== "created") {
    throw new Error(`createPatch failed: ${res.status}`);
  }
  await system.patchSync.flush();
  return res.record.patchId;
}

/** Two patches in the same patch set, plus one in a different module. */
async function scenario(system: System) {
  // An insert into the array, which shifts every later index...
  const insert = await write(system, LIST, [
    { op: "add", path: ["items", "0"], value: "inserted" },
  ]);
  // ...and an edit written against the view that HAS it.
  const after = await write(system, LIST, [
    { op: "replace", path: ["items", "1"], value: "edited" },
  ]);
  const elsewhere = await write(system, OTHER, [
    { op: "replace", path: ["title"], value: "unrelated" },
  ]);
  return { insert, after, elsewhere };
}

test("discarding a patch names what was built on top of it", async () => {
  const { system, discards } = makeSystem();
  const { insert, after, elsewhere } = await scenario(system);

  await system.discard([insert]);

  expect(discards).toHaveLength(1);
  expect(discards[0].patchIds).toEqual([insert]);
  /*
   * `after` picked index 1 against a list that had the insert in it. With the
   * insert gone, index 1 is a different element — so its membership cannot
   * survive, and any group still holding it is holding a suffix.
   */
  expect(discards[0].alsoUnstage).toContain(after);
  // The discarded patch itself is not repeated: the content API drops its
  // membership by cascade.
  expect(discards[0].alsoUnstage).not.toContain(insert);
  // And a patch in another module is in another patch set, so nothing about it
  // changed.
  expect(discards[0].alsoUnstage).not.toContain(elsewhere);
});

test("discarding the newest patch of a set names nothing", async () => {
  const { system, discards } = makeSystem();
  const { after } = await scenario(system);

  // Nothing was written on top of it, so no group can be left with a hole.
  await system.discard([after]);

  expect(discards[0].alsoUnstage).toEqual([]);
});

test("a discard in an untouched module names nothing", async () => {
  const { system, discards } = makeSystem();
  const { elsewhere } = await scenario(system);

  await system.discard([elsewhere]);

  expect(discards[0].alsoUnstage).toEqual([]);
});

test("a deployment without patch groups computes no closure at all", async () => {
  /*
   * There are no memberships to repair, and `ValOpsFS.deletePatches` ignores
   * the answer — so a full worker patch-set build here is pure delay in front
   * of the delete, on the longest chains most of all.
   *
   * Keyed on the DEPLOYMENT having groups, not on this client being scoped. An
   * http client in the window before its scope is seeded is unscoped while
   * other people's groups exist perfectly well, and skipping there would let a
   * discard leave them holding a suffix.
   */
  const { system, discards } = makeSystem({ patchGroups: false });
  const { insert } = await scenario(system);

  await system.discard([insert]);

  expect(discards[0].alsoUnstage).toEqual([]);
});
