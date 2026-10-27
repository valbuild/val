import { initVal, type PatchId } from "@valbuild/core";
import { createSystem } from "./createSystem";
import { mfp } from "./testSystem";

/**
 * Who a patch made in THIS session belongs to.
 *
 * The review UI groups by `authorId` and names each group from `/profiles`, so a
 * record with no author renders as "Unknown author" in `http` mode. A locally
 * created record is never re-fetched — `onStatPatchIds` asks only for ids it has
 * no data for — so an unstamped patch stayed unknown for the life of the page,
 * beside the ones already on the server, which showed the right name. That is
 * the shape of the bug: your own changes turn anonymous as you make them.
 */
const module = () => {
  const { c, s } = initVal();
  return c.define("/t.val.ts", s.object({ title: s.string() }), {
    title: "a",
  });
};

function build(fetchPatches = async () => ({ patches: [] })) {
  const system = createSystem({ fetchPatches });
  system.host.receive([module()]);
  return system;
}

async function type(
  system: ReturnType<typeof build>,
  value: string,
): Promise<PatchId> {
  const res = await system.patchStore.createPatch(mfp("/t.val.ts"), [
    { op: "replace", path: ["title"], value },
  ]);
  if (res.status !== "created") {
    throw new Error(`Expected the patch to be created, got ${res.status}`);
  }
  return res.record.patchId;
}

function authorOf(
  system: ReturnType<typeof build>,
  patchId: PatchId,
): string | null | undefined {
  return system.patchStore.recordsFor([patchId])[0]?.authorId;
}

describe("the author of a locally created patch", () => {
  it("is nobody until something says who is editing", async () => {
    const system = build();

    const patchId = await type(system, "typed");

    // `fs` mode never leaves this state: there is no session to have a profile,
    // and the review UI reads a missing author there as "Local changes".
    expect(authorOf(system, patchId)).toBe(null);
    system.dispose();
  });

  it("is the id the system was told, so the studio can name you at once", async () => {
    const system = build();
    system.setAuthorId("profile-a");

    const patchId = await type(system, "typed");

    expect(authorOf(system, patchId)).toBe("profile-a");
    system.dispose();
  });

  it("survives the stat that announces it, which does not re-fetch the record", async () => {
    const fetchPatches = jest.fn(async () => ({ patches: [] }));
    const system = build(fetchPatches);
    system.setAuthorId("profile-a");
    const patchId = await type(system, "typed");

    // The server now names it. Nothing is fetched — the record is already here —
    // so the stamp is the only thing that can carry the author until a reload.
    system.stat.receiveStat({ patches: [patchId], baseSha: "sha" });
    await Promise.resolve();

    expect(fetchPatches).not.toHaveBeenCalled();
    expect(authorOf(system, patchId)).toBe("profile-a");
    system.dispose();
  });

  it("is whoever was editing when the patch was made", async () => {
    const system = build();
    system.setAuthorId("profile-a");
    const first = await type(system, "typed");

    // A later answer must not rewrite the history of an earlier patch: the
    // server recorded the author it had at the time of each `PUT`.
    system.setAuthorId("profile-b");
    const second = await type(system, "typed again");

    expect(authorOf(system, first)).toBe("profile-a");
    expect(authorOf(system, second)).toBe("profile-b");
    system.dispose();
  });
});
