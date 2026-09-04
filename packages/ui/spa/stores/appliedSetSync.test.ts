import {
  initVal,
  type ModuleFilePath,
  type PatchId,
  type SourcePath,
} from "@valbuild/core";
import { createSystem } from "./createSystem";
import type { PatchRecord } from "./types";

/**
 * Learning that somebody else's publish shipped a patch you are holding.
 *
 * A published patch stays in the chain with `appliedAt` set until the next
 * deployment moves the base — so "in the chain" and "has shipped" are different
 * questions, and the id list `/stat` sends answers only the first. A record is
 * fetched once and then held, so a client never re-reads one it already has and
 * never found out on its own.
 *
 * The consequence was not cosmetic. The patch stayed pending in your scope,
 * `prefixViolations` read a hole in front of it, and Publish refused with a
 * reason that had stopped being true before you read it.
 *
 * Absent is not empty: a server that says nothing — `fs` mode, or one that
 * predates the field — has to leave every record where it is, or the next stat
 * un-applies the whole chain.
 */

const MODULE = "/a.val.ts" as ModuleFilePath;
const TITLE = '/a.val.ts?p="title"' as SourcePath;
const THEIRS = "theirs" as PatchId;

const project = () => {
  const { c, s } = initVal();
  return [c.define(MODULE, s.object({ title: s.string() }), { title: "base" })];
};

/** Another author's patch, pending as far as this client has been told. */
const FOREIGN: PatchRecord = {
  patchId: THEIRS,
  moduleFilePath: MODULE,
  patch: [{ op: "replace", path: ["title"], value: "theirs" }],
  createdAt: "2026-01-01T00:00:00.000Z",
  authorId: "someone-else",
  appliedAt: null,
};

function makeSystem() {
  const system = createSystem({
    fetchPatches: async (patchIds) => ({
      patches: patchIds.includes(THEIRS) ? [FOREIGN] : [],
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
  });
  system.host.receive(project());
  system.stat.receiveStat({ patches: [], baseSha: "sha" });
  return system;
}

/** Deliver the foreign patch, so this client holds its record. */
async function deliver(
  system: ReturnType<typeof makeSystem>,
  appliedPatches?: PatchId[],
): Promise<void> {
  system.stat.receiveStat({
    patches: [THEIRS],
    baseSha: "sha",
    ...(appliedPatches !== undefined ? { appliedPatches } : {}),
  });
  await system.patchSync.flush();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const appliedAtOf = (system: ReturnType<typeof makeSystem>) =>
  system.patchStore.allRecords().find((record) => record.patchId === THEIRS)
    ?.appliedAt;

test("a patch the server calls applied is marked applied", async () => {
  const system = makeSystem();
  await deliver(system);
  // `null` is the server saying "known, not committed" — pending.
  expect(appliedAtOf(system)).toBeNull();

  // Somebody else publishes. The id is still in the chain; nothing re-fetches
  // the record, so this list is the only way the news arrives.
  await deliver(system, [THEIRS]);

  expect(appliedAtOf(system)).toBeTruthy();
});

test("a stat that says nothing leaves the record alone", async () => {
  const system = makeSystem();
  await deliver(system, [THEIRS]);
  expect(appliedAtOf(system)).toBeTruthy();

  /*
   * `fs` mode, or a server that predates the field. Reading absence as an empty
   * list would un-apply this on the very next stat — and every reader keys on
   * `appliedAt`, so the whole chain would go back to looking pending.
   */
  await deliver(system);

  expect(appliedAtOf(system)).toBeTruthy();
});

test("an applied patch is visible under a scope that does not hold it", async () => {
  const system = makeSystem();
  await deliver(system);
  system.setPatchGroup([]);
  // Held: pending, and outside this client's group.
  expect(system.sourceStore.peek(TITLE)).toMatchObject({ data: "base" });

  await deliver(system, [THEIRS]);

  /*
   * The point of the whole exercise. Committed work is nobody's to hold back,
   * so the moment the server says it shipped it applies regardless of scope —
   * without waiting for the deploy that moves the base.
   */
  expect(system.sourceStore.peek(TITLE)).toMatchObject({ data: "theirs" });
});

test("a record that arrives AFTER the news is still marked", async () => {
  /*
   * The routine order, not a corner. `/stat` announces the ids and the fetch
   * follows, so the pass that runs on the stat has nothing to mark for exactly
   * the patch it was just told about — the record is not here yet. The ids are
   * latched and re-applied on delivery, which is what makes both orders the
   * same.
   */
  const system = makeSystem();

  // First sight of this patch and the news that it shipped, in one stat.
  await deliver(system, [THEIRS]);

  expect(appliedAtOf(system)).toBeTruthy();
});

test("an unknown id is ignored rather than invented", async () => {
  const system = makeSystem();
  // Named as applied before its record has arrived. There is nothing to mark,
  // and fabricating a record would put a patch with no ops in the chain.
  await deliver(system, ["never-seen" as PatchId]);
  expect(
    system.patchStore
      .allRecords()
      .some((record) => record.patchId === ("never-seen" as PatchId)),
  ).toBe(false);
});
