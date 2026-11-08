import { initVal, type ModuleFilePath, type PatchId } from "@valbuild/core";
import { createSystem, type System } from "./createSystem";

/**
 * A discard and a publish move the chain as surely as a save does, and say so
 * the same way: the version they answer with floors the stat store, so a
 * `/stat` read before them — which still lists the discarded patch, or lists
 * the published ones as pending — is dropped rather than adopted.
 */
describe("a discard or a publish floors the stat store too", () => {
  const MODULE = "/t.val.ts" as ModuleFilePath;
  const project = () => {
    const { c, s } = initVal();
    return [
      c.define(MODULE, s.object({ title: s.string() }), { title: "base" }),
    ];
  };

  function makeSystem() {
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
        headVersion: 2,
      }),
      publishPatches: async () => ({ status: "published", headVersion: 5 }),
      discardPatches: async (patchIds) => ({
        status: "discarded",
        patchIds,
        headVersion: 5,
      }),
      mode: "http",
    });
    system.host.receive(project());
    system.stat.receiveStat({ patches: [], baseSha: "sha", headVersion: 1 });
    return system;
  }

  async function write(system: System): Promise<PatchId> {
    const res = await system.patchStore.createPatch(MODULE, [
      { op: "replace", path: ["title"], value: "edited" },
    ]);
    if (res.status !== "created") {
      throw new Error(`createPatch failed: ${res.status}`);
    }
    await system.patchSync.flush();
    return res.record.patchId;
  }

  function adoptedAfter(system: System, act: () => void): PatchId[][] {
    const adopted: PatchId[][] = [];
    const stop = system.stat.events.on("stat:receive", (event) => {
      adopted.push(event.patches);
    });
    act();
    stop();
    return adopted;
  }

  it("drops a stat read before a discard", async () => {
    const system = makeSystem();
    const mine = await write(system);
    expect((await system.discard([mine])).status).toBe("discarded");

    const adopted = adoptedAfter(system, () =>
      system.stat.receiveStat({
        patches: [mine],
        headPatchId: mine,
        baseSha: "sha",
        headVersion: 4,
      }),
    );

    expect(adopted).toEqual([]);
    system.dispose();
  });

  it("drops a stat read before a publish", async () => {
    const system = makeSystem();
    const mine = await write(system);
    expect((await system.publish([mine], "ship it")).status).toBe("published");

    const adopted = adoptedAfter(system, () =>
      system.stat.receiveStat({
        patches: [mine],
        headPatchId: mine,
        baseSha: "sha",
        headVersion: 4,
      }),
    );

    expect(adopted).toEqual([]);
    system.dispose();
  });
});
