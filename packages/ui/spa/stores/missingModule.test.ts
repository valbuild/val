import { initVal, type PatchId } from "@valbuild/core";
import { createSystem } from "./createSystem";
import { externalPatch } from "./testSystem";

/**
 * An unpublished change to a module the project no longer has.
 *
 * Renaming or deleting a `.val` file that has unpublished changes leaves those
 * changes on the server, naming a module this Studio does not run. They used to
 * be "not loaded yet", which is a wait — and the module was never going to
 * arrive, so the Studio held every field on "Loading unpublished changes…" for
 * the life of the tab.
 *
 * It is an answer, not a wait, once the project's modules are in. And it is not
 * the "cannot apply" that is deleted on sight either: the change is someone's
 * edit, and the file may be coming back (an undo, a branch switch, an HMR edit
 * half done). So it is reported, and discarding it is the editor's call.
 */
const module = () => {
  const { c, s } = initVal();
  return c.define("/t.val.ts", s.object({ title: s.string() }), {
    title: "published",
  });
};

const gonePatch = (patchId: string) =>
  externalPatch(patchId, "/gone.val.ts", [
    { op: "replace", path: ["title"], value: "edited before the rename" },
  ]);

async function settle(system: ReturnType<typeof createSystem>) {
  for (let i = 0; i < 50 && !system.patchStore.chainSettled(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("a change to a module that is not in the project", () => {
  it("does not hold the editor", async () => {
    const system = createSystem({
      fetchPatches: async (patchIds) => ({ patches: patchIds.map(gonePatch) }),
    });
    system.host.receive([module()]);
    system.stat.receiveStat({ patches: ["p1" as PatchId], baseSha: "sha" });
    await settle(system);

    expect(system.patchStore.chainSettled()).toBe(true);
    expect(system.patchStore.changesWithoutModule()).toEqual([
      { patchId: "p1", moduleFilePath: "/gone.val.ts" },
    ]);
    system.dispose();
  });

  it("is not settled by arriving before the modules do", async () => {
    const system = createSystem({
      fetchPatches: async (patchIds) => ({ patches: patchIds.map(gonePatch) }),
    });
    system.stat.receiveStat({ patches: ["p1" as PatchId], baseSha: "sha" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Nothing says which modules exist yet, so this is still a wait.
    expect(system.patchStore.chainSettled()).toBe(false);
    expect(system.patchStore.changesWithoutModule()).toEqual([]);

    system.host.receive([module()]);
    await settle(system);
    expect(system.patchStore.chainSettled()).toBe(true);
    expect(system.patchStore.changesWithoutModule()).toEqual([
      { patchId: "p1", moduleFilePath: "/gone.val.ts" },
    ]);
    system.dispose();
  });

  it("is never discarded on the editor's behalf", async () => {
    const discarded: PatchId[][] = [];
    const system = createSystem({
      fetchPatches: async (patchIds) => ({ patches: patchIds.map(gonePatch) }),
      discardPatches: async (patchIds) => {
        discarded.push(patchIds);
        return { status: "discarded", patchIds };
      },
    });
    system.host.receive([module()]);
    system.stat.receiveStat({ patches: ["p1" as PatchId], baseSha: "sha" });
    await settle(system);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(discarded).toEqual([]);
    expect(system.patchStore.allRecords().map((r) => r.patchId)).toEqual([
      "p1",
    ]);
    system.dispose();
  });

  it("applies once the module is back", async () => {
    const system = createSystem({
      fetchPatches: async (patchIds) => ({
        patches: patchIds.map((patchId) =>
          externalPatch(patchId, "/t.val.ts", [
            { op: "replace", path: ["title"], value: "edited" },
          ]),
        ),
      }),
    });
    const { c, s } = initVal();
    const other = c.define("/other.val.ts", s.object({ n: s.number() }), {
      n: 1,
    });
    system.host.receive([other]);
    system.stat.receiveStat({ patches: ["p1" as PatchId], baseSha: "sha" });
    await settle(system);
    expect(system.patchStore.changesWithoutModule()).toHaveLength(1);

    // The file is restored, and the next intake (an HMR re-run) has it.
    system.host.receive([other, module()]);
    expect(system.patchStore.changesWithoutModule()).toEqual([]);
    expect(
      system.sourceStore.peek('/t.val.ts?p="title"' as never),
    ).toMatchObject({ data: "edited" });
    system.dispose();
  });
});
