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
 * write. Someone unstaging a colleague's patch, or putting back one they unstaged
 * earlier, is doing something perfectly ordinary in either.
 *
 * It used to move the local scope and return. Nothing went to the server, so
 * the change was gone on reload — and for an unstage that is the dangerous
 * direction: the patch silently comes back staged and the next publish ships
 * what the user meant to hold.
 *
 * Then it was held in a queue on the system until a write created a group. That
 * kept it for the life of the tab and no longer: a reload, another browser of
 * the same user, or a closed tab never saw it. Now it is sent at once with no
 * group id, and the content API stages it into the caller's open group,
 * creating one if there is none — so the change is on the server, and in every
 * other Studio's next stat, the moment it is made.
 */

const MODULE = "/a.val.ts" as ModuleFilePath;
const TITLE = '/a.val.ts?p="title"' as SourcePath;

const project = () => {
  const { c, s } = initVal();
  return [c.define(MODULE, s.object({ title: s.string() }), { title: "base" })];
};

type Sent = {
  /** `undefined` is the caller's open group, created by a stage if needed. */
  patchGroupId: string | undefined;
  type: "stage" | "unstage";
  patchIds: PatchId[];
  withPatchIds: PatchId[];
};

function makeSystem(options?: {
  stageFails?: boolean;
  /** The content API's 409: this group has already shipped. */
  stageSaysPublished?: boolean;
}) {
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
      if (options?.stageSaysPublished) {
        return {
          status: "error",
          message: "Patch group is already published",
          reason: "group-published",
        };
      }
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

test("a change with no group id goes out at once, to the caller's own group", async () => {
  const { system, sent } = makeSystem();

  system.persistPatchGroupChange(undefined, unstage(["a" as PatchId]));
  await settle();

  // No id: the content API resolves the caller's open group. Nothing waits for
  // a write to create one, so a reload or another browser sees it too.
  expect(sent).toEqual([
    {
      patchGroupId: undefined,
      type: "unstage",
      patchIds: ["a"],
      withPatchIds: [],
    },
  ]);
});

test("changes with no group id go out in the order they were made", async () => {
  const { system, sent } = makeSystem();

  // The same patch, toggled. The server unions on stage and removes on
  // unstage, so the order decides the membership it ends with.
  system.persistPatchGroupChange(undefined, stage(["a" as PatchId]));
  system.persistPatchGroupChange(undefined, unstage(["a" as PatchId]));
  system.persistPatchGroupChange(undefined, stage(["a" as PatchId]));
  await settle();

  expect(sent.map((call) => call.type)).toEqual(["stage", "unstage", "stage"]);
});

test("an empty change is not sent", async () => {
  const { system, sent } = makeSystem();

  system.persistPatchGroupChange("g1", stage([]));
  system.persistPatchGroupChange(undefined, stage([]));
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

test("a 409 on stage makes this tab stop naming the group it just lost", async () => {
  /*
   * The same author, two tabs, and the wedge that follows a publish in one of
   * them.
   *
   * A group belongs to a person, so the other tab is the only thing that can
   * close it — and once it has, the id this tab is holding will never be
   * writable again. Keeping it turned every later stage and unstage into the
   * same 409, logged and nothing else, for the rest of the session: the
   * annotation refreshes only inside a fetch for MISSING patch ids, and on a
   * quiet branch there are none to fetch, so nothing would ever correct it.
   *
   * Forgetting hands the question back to `useCurrentPatchGroup`, which falls
   * through to the annotation; the change itself is resent with no id (see the
   * next test).
   */
  const { system } = makeSystem({ stageSaysPublished: true });
  system.patchStore.recordOwnPatchGroup("g1");
  expect(system.patchStore.ownGroupId()).toBe("g1");

  system.persistPatchGroupChange("g1", stage(["a" as PatchId]));
  await settle();

  expect(system.patchStore.ownGroupId()).toBe(undefined);
});

test("an ordinary failure keeps the group, because the id is still good", async () => {
  /*
   * The control, and the reason the reason is carried apart from the message: a
   * network blip or a 500 says nothing about whether the group is still this
   * author's to write to. Forgetting the id there would send every subsequent
   * click down the deferred path for no reason, and drop the write resolver
   * with it until the next save answered.
   */
  const { system } = makeSystem({ stageFails: true });
  system.patchStore.recordOwnPatchGroup("g1");

  system.persistPatchGroupChange("g1", stage(["a" as PatchId]));
  await settle();

  expect(system.patchStore.ownGroupId()).toBe("g1");
});

test("a change refused because the group shipped is resent to the open group", async () => {
  /*
   * The user's click is not lost to a publish they made in another tab: with
   * no id the content API stages into whichever group is open now, creating
   * it if the publish left none.
   */
  const { system, sent } = makeSystem({ stageSaysPublished: true });
  system.patchStore.recordOwnPatchGroup("g1");

  system.persistPatchGroupChange("g1", stage(["a" as PatchId]));
  await settle();

  expect(sent.map((call) => call.patchGroupId)).toEqual(["g1", undefined]);
});
