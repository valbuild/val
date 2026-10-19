import { initVal, type ModuleFilePath, type PatchId } from "@valbuild/core";
import { createSystem, type System } from "./createSystem";

/**
 * Content refuses to discard a change a running publish holds, and names the
 * publish. The name has to reach the Studio's discard: it is what lets the
 * refusal offer "Cancel publish" rather than only say no.
 */
describe("a discard refused because a publish holds the change", () => {
  const MODULE = "/t.val.ts" as ModuleFilePath;
  const project = () => {
    const { c, s } = initVal();
    return [
      c.define(MODULE, s.object({ title: s.string() }), { title: "base" }),
    ];
  };

  function makeSystem(): System {
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
      discardPatches: async () => ({
        status: "error",
        message:
          "This change is being published right now, so it cannot be discarded until the publish ends.",
        publishJobId: "job-1",
      }),
      mode: "http",
    });
    system.host.receive(project());
    system.stat.receiveStat({ patches: [], baseSha: "sha", headVersion: 1 });
    return system;
  }

  it("fails with the publish that holds it", async () => {
    const system = makeSystem();
    const res = await system.patchStore.createPatch(MODULE, [
      { op: "replace", path: ["title"], value: "edited" },
    ]);
    if (res.status !== "created") {
      throw new Error(`createPatch failed: ${res.status}`);
    }
    await system.patchSync.flush();
    const mine = res.record.patchId;

    expect(await system.discard([mine])).toEqual({
      status: "failed",
      message:
        "This change is being published right now, so it cannot be discarded until the publish ends.",
      publishJobId: "job-1",
    });
  });
});
