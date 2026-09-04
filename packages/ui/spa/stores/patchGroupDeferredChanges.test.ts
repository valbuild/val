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

type Sent = {
  patchGroupId: string;
  type: "stage" | "unstage";
  patchIds: PatchId[];
  withPatchIds: PatchId[];
};

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
    stagePatches: async ({ patchGroupId, patchIds, withPatchIds }) => {
      sent.push({ patchGroupId, type: "stage", patchIds, withPatchIds });
      return options?.stageFails
        ? { status: "error", message: "nope" }
        : { status: "ok" };
    },
    unstagePatches: async ({ patchGroupId, patchIds, withPatchIds }) => {
      sent.push({ patchGroupId, type: "unstage", patchIds, withPatchIds });
      return { status: "ok" };
    },
  });
  system.host.receive(project());
  system.stat.receiveStat({ patches: [], baseSha: "sha" });
  return { system, sent };
}

/** Let the fire-and-forget sends settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Nothing came with it by default — the plain "the user clicked this" case.
 */
const stage = (
  patchIds: PatchId[],
  withPatchIds: PatchId[] = [],
): PatchGroupChangeRequest => ({
  type: "stage",
  patchIds,
  withPatchIds,
});
const unstage = (
  patchIds: PatchId[],
  withPatchIds: PatchId[] = [],
): PatchGroupChangeRequest => ({
  type: "unstage",
  patchIds,
  withPatchIds,
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
      withPatchIds: [],
    },
  ]);
});

test("a stage keeps what the user asked for apart from what came with it", async () => {
  const { system, sent } = makeSystem();

  /*
   * `a` is the click; `theirs` came along because the closure pulled it in.
   * The content API records each membership row as `explicit` or `dependency`
   * and reads what it is not told about as a dependency, so folding the two
   * into one list files the patch someone chose as one they never asked for —
   * and that row is the only record of the difference.
   */
  system.persistPatchGroupChange(
    "g1",
    stage(["a" as PatchId], ["theirs" as PatchId]),
  );
  await settle();

  expect(sent[0]).toMatchObject({
    patchIds: ["a"],
    withPatchIds: ["theirs"],
  });
});

test("an unstage carries the same split, and both halves go", async () => {
  const { system, sent } = makeSystem();
  // Both are removed identically, but the request still says which is which —
  // and dropping `withPatchIds` would leave the group holding the later half of
  // a patch set without the earlier half.
  system.persistPatchGroupChange(
    "g1",
    unstage(["a" as PatchId], ["later" as PatchId]),
  );
  await settle();

  expect(sent[0]).toMatchObject({
    patchIds: ["a"],
    withPatchIds: ["later"],
  });
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
      withPatchIds: [],
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

test("a queued unstage is dropped when the scope has taken the patch back", async () => {
  const { system, sent } = makeSystem();
  /*
   * The case the queue was added for, and the one it got wrong.
   *
   * Alice unstages Bob's patch while she has no group. Then she edits a field
   * in the same patch set, which creates her group AND runs the write closure
   * — and that closure pulls Bob's patch back in, because her edit sits on top
   * of it. Replaying the unstage verbatim afterwards took it out of the group
   * on the server while the local scope, and therefore publish, still held it:
   * a hole in front of her own patch, surfacing only as a publish refusal
   * naming raw ids, and only after a reload.
   *
   * The scope is what this client intends the group to be, and every click has
   * already been folded into it. So where the queue and the scope disagree, the
   * scope wins — the write beating the earlier click, as it must.
   */
  system.persistPatchGroupChange(undefined, unstage(["theirs" as PatchId]));
  system.setPatchGroup(["p1" as PatchId, "theirs" as PatchId]);

  system.flushPatchGroupChanges("g-new");
  await settle();

  expect(sent).toEqual([]);
});

test("a queued stage is dropped when the scope no longer holds the patch", async () => {
  const { system, sent } = makeSystem();
  // The mirror image: staged while there was no group, then unstaged again
  // before one existed. Sending the stage would put back what she just removed.
  system.persistPatchGroupChange(undefined, stage(["theirs" as PatchId]));
  system.setPatchGroup(["p1" as PatchId]);

  system.flushPatchGroupChanges("g-new");
  await settle();

  expect(sent).toEqual([]);
});

test("a queued change that still agrees with the scope is sent", async () => {
  const { system, sent } = makeSystem();
  system.persistPatchGroupChange(undefined, unstage(["theirs" as PatchId]));
  system.persistPatchGroupChange(undefined, stage(["mine" as PatchId]));
  // `theirs` stayed out and `mine` stayed in, so both clicks still stand.
  system.setPatchGroup(["p1" as PatchId, "mine" as PatchId]);

  system.flushPatchGroupChanges("g-new");
  await settle();

  expect(sent.map((call) => [call.type, call.patchIds])).toEqual([
    ["unstage", ["theirs"]],
    ["stage", ["mine"]],
  ]);
});

test("an unscoped client replays verbatim, having no scope to reconcile against", async () => {
  const { system, sent } = makeSystem();
  // `null` is fs mode or a content API without groups. Filtering against a
  // scope that does not exist would drop everything.
  system.persistPatchGroupChange(undefined, unstage(["theirs" as PatchId]));

  system.flushPatchGroupChanges("g-new");
  await settle();

  expect(sent.map((call) => call.patchIds)).toEqual([["theirs"]]);
});

test("the studio still reads normally around all of this", async () => {
  const { system } = makeSystem();
  system.persistPatchGroupChange(undefined, stage(["a" as PatchId]));
  expect(system.sourceStore.peek(TITLE)).toMatchObject({
    status: "ready",
    data: "base",
  });
});
