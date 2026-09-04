import {
  initVal,
  type ModuleFilePath,
  type PatchId,
  type SourcePath,
} from "@valbuild/core";
import { createSystem, type PatchGroupChangeRequest } from "./createSystem";

/**
 * A stage made before there is a group to stage into.
 *
 * `patchGroupId` is `undefined` in two windows, and the review screen works in
 * both: before this author's first write on a branch, and after every publish,
 * because a publish CLOSES the group and the next one is created by the next
 * write. Someone unstaging a colleague's patch, or putting back one they held
 * earlier, is doing something perfectly ordinary in either.
 *
 * It used to move the local scope and return. Nothing went to the server, so
 * the change was gone on reload — and for an unstage that is the dangerous
 * direction: the patch silently comes back staged and the next publish ships
 * what the user meant to hold.
 *
 * The queue is on the SYSTEM rather than on the review screen because the id
 * normally appears BECAUSE the user left that screen and typed something. A
 * queue on the screen is unmounted before it can be flushed.
 */

const MODULE = "/a.val.ts" as ModuleFilePath;
const TITLE = '/a.val.ts?p="title"' as SourcePath;

const project = () => {
  const { c, s } = initVal();
  return [c.define(MODULE, s.object({ title: s.string() }), { title: "base" })];
};

type Sent = PatchGroupChangeRequest & { patchGroupId: string };

function makeSystem(options?: { stageFails?: boolean }) {
  const sent: Sent[] = [];
  const system = createSystem({
    fetchPatches: async (patchIds) => ({
      patches: [],
      errors: Object.fromEntries(
        patchIds.map((patchId) => [patchId, "not available in this test"]),
      ),
    }),
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
    stagePatches: async ({ patchGroupId, patchIds, closureVersion }) => {
      sent.push({ patchGroupId, type: "stage", patchIds, closureVersion });
      return options?.stageFails
        ? { status: "error", message: "nope" }
        : { status: "ok" };
    },
    unstagePatches: async ({ patchGroupId, patchIds, closureVersion }) => {
      sent.push({ patchGroupId, type: "unstage", patchIds, closureVersion });
      return { status: "ok" };
    },
  });
  system.host.receive(project());
  system.stat.receiveStat({ patches: [], baseSha: "sha" });
  return { system, sent };
}

/** Let the fire-and-forget sends settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const stage = (patchIds: PatchId[]): PatchGroupChangeRequest => ({
  type: "stage",
  patchIds,
  closureVersion: 1,
});
const unstage = (patchIds: PatchId[]): PatchGroupChangeRequest => ({
  type: "unstage",
  patchIds,
  closureVersion: 1,
});

test("a change with a group id goes straight out", async () => {
  const { system, sent } = makeSystem();

  system.persistPatchGroupChange("g1", stage(["a" as PatchId]));
  await settle();

  expect(sent).toEqual([
    {
      patchGroupId: "g1",
      type: "stage",
      patchIds: ["a"],
      closureVersion: 1,
    },
  ]);
});

test("a change with no group id is held, then sent when one appears", async () => {
  const { system, sent } = makeSystem();

  system.persistPatchGroupChange(undefined, unstage(["a" as PatchId]));
  await settle();
  // Nothing to send it to yet. The screen has already moved — `setPatchGroup`
  // is a separate call — so the user sees the unstage either way.
  expect(sent).toEqual([]);

  // The user goes and edits something; the write creates the group and the save
  // response names it, and the shell flushes.
  system.flushPatchGroupChanges("g1");
  await settle();

  expect(sent).toEqual([
    {
      patchGroupId: "g1",
      type: "unstage",
      patchIds: ["a"],
      closureVersion: 1,
    },
  ]);
});

test("held changes replay in the order they were made", async () => {
  const { system, sent } = makeSystem();

  // The same patch, toggled twice. Replaying out of order lands on the opposite
  // membership from the one the user is looking at, which is the whole reason
  // these are a queue rather than a set.
  system.persistPatchGroupChange(undefined, stage(["a" as PatchId]));
  system.persistPatchGroupChange(undefined, unstage(["a" as PatchId]));
  system.persistPatchGroupChange(undefined, stage(["a" as PatchId]));

  system.flushPatchGroupChanges("g1");
  await settle();

  expect(sent.map((call) => call.type)).toEqual(["stage", "unstage", "stage"]);
  expect(sent.every((call) => call.patchGroupId === "g1")).toBe(true);
});

test("a flush empties the queue, so a second one sends nothing", async () => {
  const { system, sent } = makeSystem();

  system.persistPatchGroupChange(undefined, stage(["a" as PatchId]));
  system.flushPatchGroupChanges("g1");
  await settle();
  expect(sent).toHaveLength(1);

  // Every save re-announces the same id and the effect keying on it can run
  // again. Replaying would re-stage something the user has since unstaged.
  system.flushPatchGroupChanges("g1");
  await settle();
  expect(sent).toHaveLength(1);
});

test("a change made after the id is known does not queue behind the flush", async () => {
  const { system, sent } = makeSystem();

  system.persistPatchGroupChange(undefined, stage(["a" as PatchId]));
  system.flushPatchGroupChanges("g1");
  system.persistPatchGroupChange("g1", stage(["b" as PatchId]));
  await settle();

  expect(sent.map((call) => call.patchIds)).toEqual([["a"], ["b"]]);
});

test("an empty change is not sent and not queued", async () => {
  const { system, sent } = makeSystem();

  system.persistPatchGroupChange("g1", stage([]));
  system.persistPatchGroupChange(undefined, stage([]));
  system.flushPatchGroupChanges("g1");
  await settle();

  expect(sent).toEqual([]);
});

test("a refused change is logged, not thrown", async () => {
  const { system, sent } = makeSystem({ stageFails: true });
  const errors = jest.spyOn(console, "error").mockImplementation(() => {});

  system.persistPatchGroupChange("g1", stage(["a" as PatchId]));
  await settle();

  expect(sent).toHaveLength(1);
  expect(errors).toHaveBeenCalledWith(
    "Val: could not update patch group",
    "nope",
  );
  // KNOWN GAP, asserted so it is a decision rather than an oversight: the local
  // scope is NOT put back. See `docs/independent-publish/DESIGN.md`.
  errors.mockRestore();
});

test("the studio still reads normally around all of this", async () => {
  const { system } = makeSystem();
  system.persistPatchGroupChange(undefined, stage(["a" as PatchId]));
  expect(system.sourceStore.peek(TITLE)).toMatchObject({
    status: "ready",
    data: "base",
  });
});
