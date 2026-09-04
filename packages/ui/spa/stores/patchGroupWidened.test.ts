import {
  initVal,
  type ModuleFilePath,
  type PatchId,
  type SourcePath,
} from "@valbuild/core";
import { createSystem, type System } from "./createSystem";
import type { SystemEvent } from "./types";

/**
 * Saying so when a write pulls other authors' patches into your group.
 *
 * The closure is the one place other people's work enters a user's view without
 * them asking for it, and it happened in silence: the scope widened,
 * `SourceStore` rebuilt the modules, and the only trace was the number on the
 * Review button changing.
 *
 * The event is emitted here, in the store, and carries ids. Turning ids into
 * faces needs the provider, so that part lives in `PatchGroupWidenedToasts` —
 * `createSystem` has no business knowing a profile exists.
 */

const MODULE = "/a.val.ts" as ModuleFilePath;
const TITLE = '/a.val.ts?p="title"' as SourcePath;

const project = () => {
  const { c, s } = initVal();
  return [c.define(MODULE, s.object({ title: s.string() }), { title: "base" })];
};

function makeSystem() {
  const widened: PatchId[][] = [];
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
    }),
    publishPatches: async () => ({ status: "published" }),
  });
  system.host.receive(project());
  system.stat.receiveStat({ patches: [], baseSha: "sha" });
  system.patchSync.events.on("patch:group-widened", (event: SystemEvent) => {
    if (event.type !== "patch:group-widened") return;
    widened.push([...event.patches]);
  });
  return { system, widened };
}

async function edit(system: System, value: string): Promise<PatchId> {
  const res = await system.patchStore.createPatch(MODULE, [
    { op: "replace", path: ["title"], value },
  ]);
  if (res.status !== "created") throw new Error(`createPatch: ${res.status}`);
  await system.patchSync.flush();
  return res.record.patchId;
}

test("a closure that moves nothing says nothing", async () => {
  const { system, widened } = makeSystem();
  system.setPatchGroup([]);
  system.setPatchGroupResolver(async () => ({
    alsoAddPatchIds: [],
    closureVersion: 1,
  }));

  await edit(system, "mine");

  // The common case by far. A toast on every save would be noise, and the
  // user's own write is not news to them.
  expect(widened).toEqual([]);
});

test("a closure that pulls another patch in announces exactly that patch", async () => {
  const { system, widened } = makeSystem();
  system.setPatchGroup([]);
  system.setPatchGroupResolver(async () => ({
    alsoAddPatchIds: ["theirs" as PatchId],
    closureVersion: 1,
  }));

  await edit(system, "mine");

  expect(widened).toEqual([["theirs"]]);
  // And the scope really did widen — the announcement is about something that
  // happened, not instead of it.
  expect(system.patchGroup()).toContain("theirs" as PatchId);
});

test("the user's own write is not announced back to them", async () => {
  const { system, widened } = makeSystem();
  system.setPatchGroup([]);
  /*
   * A resolver that names the written patch in its own closure. The server
   * unions, so this is legal and harmless there — but reporting it would tell
   * the user their own keystroke was somebody else's change.
   */
  system.setPatchGroupResolver(async (patchIds) => ({
    alsoAddPatchIds: [...patchIds],
    closureVersion: 1,
  }));

  await edit(system, "mine");

  expect(widened).toEqual([]);
});

test("the studio still reads normally around it", async () => {
  const { system } = makeSystem();
  system.setPatchGroup([]);
  system.setPatchGroupResolver(async () => ({
    alsoAddPatchIds: ["theirs" as PatchId],
    closureVersion: 1,
  }));
  await edit(system, "mine");
  expect(system.sourceStore.peek(TITLE)).toMatchObject({
    status: "ready",
    data: "mine",
  });
});
