import {
  initVal,
  type ModuleFilePath,
  type PatchId,
  type SourcePath,
} from "@valbuild/core";
import type { PatchGroupT } from "@valbuild/shared/internal";
import {
  createSystem,
  type PatchGroupChangeRequest,
  type StagePatches,
} from "./createSystem";
import type { SavePatches, SaveResult } from "./PatchSync";
import { PatchSetStore } from "./PatchSetStore";
import { ReferenceStore } from "./ReferenceStore";
import { SearchStore } from "./SearchStore";
import type { PatchRecord } from "./types";

/**
 * A stage or unstage made while a save is on the wire.
 *
 * Membership changes on the server two ways: an explicit stage or unstage, and
 * a save, whose closure (`withPatchIds`) the server unions into the group with
 * the write. A save already waits for the group changes made before it. These
 * pin the other half: a change made while a save is in flight is SENT after
 * that save is answered, so the two cannot land in the wrong order — and the
 * server's group, once both have landed, is what this tab last asked for.
 *
 * The shape is the one the race was found with. `insert` is another author's
 * array insert; this tab edits the inserted item, so the write sits on the
 * insert and its closure is `[insert]`. While that save is in flight, the user
 * unstages the insert.
 */

const LIST = "/list.val.ts" as ModuleFilePath;
const ITEMS = '/list.val.ts?p="items"' as SourcePath;
const ME = "profile-me";
const THEM = "profile-them";
const insert = "insert" as PatchId;
const write = "write" as PatchId;

const project = () => {
  const { c, s } = initVal();
  return [
    c.define(LIST, s.object({ items: s.array(s.string()) }), {
      items: ["one"],
    }),
  ];
};

const insertRecord: PatchRecord = {
  patchId: insert,
  moduleFilePath: LIST,
  patch: [{ op: "add", path: ["items", "0"], value: "new" }],
  createdAt: "2026-01-01T00:00:00.000Z",
  authorId: THEM,
  appliedAt: null,
};

/**
 * Where a save takes effect on the server: when it is SENT, with only the
 * answer slow on the way back, or when it is ANSWERED, a request slow on the
 * way there. Over HTTP either can happen, and the fix must not depend on which.
 */
type Landing = "on-send" | "on-answer";

type Request =
  | { kind: "save"; withPatchIds: PatchId[] }
  | { kind: "stage" | "unstage"; patchIds: PatchId[]; withPatchIds: PatchId[] };

/**
 * A content API holding one user's open group, applying each request when it
 * lands, and a save whose answer the test hands out.
 */
function makeServer(landing: Landing) {
  const members = new Set<PatchId>();
  let version = 1;
  const requests: Request[] = [];
  const saves: { answer: (result?: SaveResult) => void }[] = [];
  const savePatches: SavePatches = (request) => {
    const withPatchIds = [...(request.patchGroup?.withPatchIds ?? [])];
    requests.push({ kind: "save", withPatchIds });
    const land = () => {
      for (const patch of request.patches) members.add(patch.patchId);
      for (const patchId of withPatchIds) members.add(patchId);
      version += 1;
      return version;
    };
    const landedAt = landing === "on-send" ? land() : null;
    return new Promise((resolve) => {
      saves.push({
        answer: (result) => {
          if (result !== undefined) {
            resolve(result);
            return;
          }
          const headVersion = landedAt ?? land();
          resolve({
            status: "saved",
            newPatchIds: request.patches.map((patch) => patch.patchId),
            parentRef: request.parentRef,
            patchGroupId: "g-mine",
            headVersion,
          });
        },
      });
    });
  };
  const change =
    (kind: "stage" | "unstage"): StagePatches =>
    async (request) => {
      requests.push({
        kind,
        patchIds: [...request.patchIds],
        withPatchIds: [...request.withPatchIds],
      });
      for (const patchId of [...request.patchIds, ...request.withPatchIds]) {
        if (kind === "stage") members.add(patchId);
        else members.delete(patchId);
      }
      version += 1;
      return { status: "ok", headVersion: version, patchGroupId: "g-mine" };
    };
  return {
    members,
    requests,
    saves,
    version: () => version,
    savePatches,
    stagePatches: change("stage"),
    unstagePatches: change("unstage"),
  };
}

function group(patchIds: Iterable<PatchId>): PatchGroupT {
  return {
    patchGroupId: "g-mine",
    authorId: ME,
    createdAt: "2026-01-01T00:00:00.000Z",
    publishedAt: null,
    patchIds: [...patchIds],
  };
}

const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

function makeSystem(
  server: ReturnType<typeof makeServer>,
  options: { saveSleep?: (ms: number) => Promise<void> } = {},
) {
  const system = createSystem({
    fetchPatches: async (patchIds) => ({
      patches: patchIds.includes(insert) ? [insertRecord] : [],
    }),
    createPatchId: () => write,
    savePatches: server.savePatches,
    stagePatches: server.stagePatches,
    unstagePatches: server.unstagePatches,
    saveBackoffMs: () => 0,
    ...(options.saveSleep !== undefined
      ? { saveSleep: options.saveSleep }
      : {}),
  });
  system.host.receive(project());
  system.stat.receiveStat({ patches: [], baseSha: "sha", profileId: ME });
  system.seedPatchGroup([]);
  system.setPatchGroupResolver(async (patchIds) => ({
    withPatchIds: await system.computeWriteClosure(patchIds),
  }));
  return system;
}

/** A stat at the server's current version, carrying its groups. */
async function statNow(
  system: ReturnType<typeof makeSystem>,
  server: ReturnType<typeof makeServer>,
  chain: PatchId[],
): Promise<void> {
  system.stat.receiveStat({
    patches: chain,
    baseSha: "sha",
    headVersion: server.version(),
    patchGroups: [group(server.members)],
    profileId: ME,
  });
  await system.patchSync.flush();
  await settle();
}

/** The user edits the inserted item; resolves once the save has been sent. */
async function editInsertedItem(
  system: ReturnType<typeof makeSystem>,
  server: ReturnType<typeof makeServer>,
): Promise<void> {
  const saves = server.saves.length;
  const res = await system.patchStore.createPatch(LIST, [
    { op: "replace", path: ["items", "0"], value: "new, edited" },
  ]);
  if (res.status !== "created") throw new Error(`createPatch: ${res.status}`);
  for (let i = 0; i < 20 && server.saves.length === saves; i++) await settle();
  expect(server.saves).toHaveLength(saves + 1);
}

/** What the review screen does on a click: scope locally, then persist. */
function click(
  system: ReturnType<typeof makeSystem>,
  change: PatchGroupChangeRequest,
): void {
  const moved = new Set([...change.patchIds, ...change.withPatchIds]);
  const scope = system.patchGroup() ?? [];
  system.setPatchGroup(
    change.type === "unstage"
      ? scope.filter((patchId) => !moved.has(patchId))
      : [...scope, ...moved],
  );
  system.persistPatchGroupChange(undefined, change);
}

function items(system: ReturnType<typeof makeSystem>): unknown {
  const peek = system.sourceStore.peek(ITEMS);
  return peek.status === "ready" ? peek.data : peek.status;
}

async function setUp(landing: Landing) {
  const server = makeServer(landing);
  const system = makeSystem(server);
  await statNow(system, server, [insert]);
  // Somebody else's insert: in the chain, not in this user's group.
  expect(system.patchGroup()).toEqual([]);
  await editInsertedItem(system, server);
  // The write sits on the insert, so its closure brings the insert along.
  expect(server.requests).toEqual([{ kind: "save", withPatchIds: [insert] }]);
  expect(system.patchGroup()).toEqual(expect.arrayContaining([insert, write]));
  return { server, system };
}

describe.each<Landing>(["on-answer", "on-send"])(
  "a save that lands %s",
  (landing) => {
    test("an unstage of its closure made while it is in flight is not undone by it", async () => {
      const { server, system } = await setUp(landing);

      // The forward closure of the insert includes the write on top of it.
      click(system, {
        type: "unstage",
        patchIds: [insert],
        withPatchIds: [write],
      });
      await settle();
      // Not sent yet: it waits for the save it would otherwise race.
      expect(server.requests.map((request) => request.kind)).toEqual(["save"]);

      server.saves[0].answer();
      await settle();

      // The last membership request is the user's unstage, so it is what the
      // server holds.
      expect(server.requests.at(-1)).toEqual({
        kind: "unstage",
        patchIds: [insert],
        withPatchIds: [write],
      });
      expect(server.members.has(insert)).toBe(false);
      expect(server.members.has(write)).toBe(false);

      // And a stat at the final version agrees with what the tab showed.
      expect(system.patchGroup()).not.toContain(insert);
      await statNow(system, server, [insert, write]);
      expect(system.patchGroup()).not.toContain(insert);
      expect(system.patchGroup()).not.toContain(write);
      expect(items(system)).toEqual(["one"]);
    });

    test("an unstage whose forward closure missed the write still takes the write out with it", async () => {
      const { server, system } = await setUp(landing);

      /*
       * The review screen's patch-set index had not caught up with the write,
       * so the forward closure of the insert came out without it. Sent as is
       * after the save, it would leave the write in the group without the
       * insert it was written on: a hole a reload would show.
       */
      click(system, { type: "unstage", patchIds: [insert], withPatchIds: [] });
      await settle();
      server.saves[0].answer();
      await settle();

      expect(server.requests.at(-1)).toMatchObject({ kind: "unstage" });
      // Never the write without the insert beneath it.
      if (server.members.has(write)) {
        expect(server.members.has(insert)).toBe(true);
      }
      // And what the user asked for: the insert is out, so the write on top of
      // it is too.
      expect(server.members.has(insert)).toBe(false);
      expect(server.members.has(write)).toBe(false);
      // This tab shows it straight away, not only after the next stat.
      expect(system.patchGroup()).not.toContain(write);

      await statNow(system, server, [insert, write]);
      expect(system.patchGroup()).not.toContain(insert);
      expect(system.patchGroup()).not.toContain(write);
      expect(items(system)).toEqual(["one"]);
    });
  },
);

test("a stage made while a save is in flight waits for it too, and lands", async () => {
  const { server, system } = await setUp("on-answer");
  click(system, { type: "unstage", patchIds: [insert], withPatchIds: [write] });
  click(system, { type: "stage", patchIds: [write], withPatchIds: [insert] });
  await settle();
  expect(server.requests.map((request) => request.kind)).toEqual(["save"]);

  server.saves[0].answer();
  await settle();

  expect(server.requests.map((request) => request.kind)).toEqual([
    "save",
    "unstage",
    "stage",
  ]);
  expect([...server.members].sort()).toEqual([insert, write].sort());
  await statNow(system, server, [insert, write]);
  expect(system.patchGroup()).toEqual(expect.arrayContaining([insert, write]));
  expect(items(system)).toEqual(["new, edited", "one"]);
});

test("a save that fails releases the changes waiting on it", async () => {
  const errors = jest.spyOn(console, "error").mockImplementation(() => {});
  let wake: (() => void) | null = null;
  const server = makeServer("on-answer");
  // The retry waits until the test lets it go.
  const system = makeSystem(server, {
    saveSleep: () =>
      new Promise((resolve) => {
        wake = () => resolve();
      }),
  });
  await statNow(system, server, [insert]);
  await editInsertedItem(system, server);

  click(system, { type: "unstage", patchIds: [insert], withPatchIds: [write] });
  await settle();
  expect(server.requests.map((request) => request.kind)).toEqual(["save"]);

  server.saves[0].answer({ status: "network-error", message: "offline" });
  await settle();
  // Sent once the save was answered, even though the answer was a failure.
  expect(server.requests.map((request) => request.kind)).toEqual([
    "save",
    "unstage",
  ]);
  errors.mockRestore();

  /*
   * The retry. The server puts a write in its author's group whatever the
   * write says, so saving it at all stages it — and its closure with it. The
   * user took both out before this save went, so the tab follows the save
   * with an unstage of its own, ordered behind it like a click would be.
   */
  if (wake === null) throw new Error("the save was not retried");
  const retry: () => void = wake;
  retry();
  for (let i = 0; i < 20 && server.saves.length === 1; i++) await settle();
  expect(server.saves).toHaveLength(2);
  expect(server.requests.at(-1)).toEqual({
    kind: "save",
    withPatchIds: [insert],
  });
  expect(system.patchGroup()).not.toContain(insert);
  expect(system.patchGroup()).not.toContain(write);

  server.saves[1].answer();
  await settle();
  expect(server.requests.at(-1)).toMatchObject({ kind: "unstage" });
  expect(server.members.has(insert)).toBe(false);
  expect(server.members.has(write)).toBe(false);

  await statNow(system, server, [insert, write]);
  expect(system.patchGroup()).not.toContain(insert);
  expect(system.patchGroup()).not.toContain(write);
  expect(items(system)).toEqual(["one"]);
});

test("disposing during a save sends the changes waiting on it once the save is answered, never before", async () => {
  const { server, system } = await setUp("on-answer");

  click(system, { type: "unstage", patchIds: [insert], withPatchIds: [write] });
  await settle();
  // Held while the save is in flight...
  expect(server.requests.map((request) => request.kind)).toEqual(["save"]);

  // ...and still held when the system is torn down under it: `dispose` does
  // not cancel the request, so an unstage sent now could land first and have
  // the save put back what it took out.
  system.dispose();
  await settle();
  expect(server.requests.map((request) => request.kind)).toEqual(["save"]);

  // The save lands, and the click follows it rather than being lost.
  server.saves[0].answer();
  await settle();
  expect(server.requests.map((request) => request.kind)).toEqual([
    "save",
    "unstage",
  ]);
  expect(server.members.has(insert)).toBe(false);
  expect(server.members.has(write)).toBe(false);
});

test("disposing while a save's closure is still being worked out sends the changes waiting on it", async () => {
  const server = makeServer("on-answer");
  const system = makeSystem(server);
  await statNow(system, server, [insert]);
  // A closure that never answers: no save can be sent behind it.
  system.setPatchGroupResolver(() => new Promise(() => {}));
  const res = await system.patchStore.createPatch(LIST, [
    { op: "replace", path: ["items", "0"], value: "new, edited" },
  ]);
  if (res.status !== "created") throw new Error(`createPatch: ${res.status}`);
  await settle();

  click(system, { type: "stage", patchIds: [insert], withPatchIds: [] });
  await settle();
  expect(server.requests).toEqual([]);

  system.dispose();
  await settle();

  // Nothing is on the wire to race, so the click goes out now.
  expect(server.requests.map((request) => request.kind)).toEqual(["stage"]);
});

test("with no grouping, unstaging one write of a batch takes the later writes of that batch with it", async () => {
  const server = makeServer("on-answer");
  let groupingFails = false;
  const patchSets = new PatchSetStore();
  let next = 0;
  const system = createSystem({
    workerRealm: {
      search: new SearchStore(),
      references: new ReferenceStore(),
      patchSets: {
        getPatchSets: async (request) => {
          if (groupingFails) throw new Error("no grouping in this test");
          return patchSets.getPatchSets(request);
        },
      },
    },
    fetchPatches: async () => ({ patches: [] }),
    createPatchId: () => `batch-${++next}` as PatchId,
    savePatches: server.savePatches,
    stagePatches: server.stagePatches,
    unstagePatches: server.unstagePatches,
    saveBackoffMs: () => 0,
  });
  system.host.receive(project());
  system.seedPatchGroup([]);
  system.setPatchGroupResolver(async () => ({ withPatchIds: [] }));

  // Two writes made before there is a parent to save against, so they go out
  // as ONE batch once a stat arrives: the second sits on the first.
  for (const value of ["first", "second"]) {
    const res = await system.patchStore.createPatch(LIST, [
      { op: "replace", path: ["items", "0"], value },
    ]);
    if (res.status !== "created") throw new Error(`createPatch: ${res.status}`);
  }
  const [first, second] = ["batch-1", "batch-2"] as PatchId[];
  system.stat.receiveStat({ patches: [], baseSha: "sha", profileId: ME });
  for (let i = 0; i < 20 && server.saves.length === 0; i++) await settle();
  expect(server.saves).toHaveLength(1);

  // The user unstages the first write alone while the save is in flight, and
  // the grouping cannot be had to work out what sits on it.
  groupingFails = true;
  click(system, { type: "unstage", patchIds: [first], withPatchIds: [] });
  server.saves[0].answer();
  await settle();

  expect(server.requests.at(-1)).toEqual({
    kind: "unstage",
    patchIds: [first],
    withPatchIds: [second],
  });
  // Never the second write without the first beneath it.
  expect(server.members.has(first)).toBe(false);
  expect(server.members.has(second)).toBe(false);
  expect(system.patchGroup()).not.toContain(second);
});

test("a retried batch whose earlier write was unstaged during the backoff takes the later writes out with it", async () => {
  const errors = jest.spyOn(console, "error").mockImplementation(() => {});
  const server = makeServer("on-answer");
  let wake: (() => void) | null = null;
  let next = 0;
  const system = createSystem({
    fetchPatches: async () => ({ patches: [] }),
    createPatchId: () => `retry-${++next}` as PatchId,
    savePatches: server.savePatches,
    stagePatches: server.stagePatches,
    unstagePatches: server.unstagePatches,
    saveBackoffMs: () => 0,
    saveSleep: () =>
      new Promise((resolve) => {
        wake = () => resolve();
      }),
  });
  system.host.receive(project());
  system.seedPatchGroup([]);
  system.setPatchGroupResolver(async () => ({ withPatchIds: [] }));

  // Two writes made before there is a parent, so they go out as ONE batch.
  for (const value of ["first", "second"]) {
    const res = await system.patchStore.createPatch(LIST, [
      { op: "replace", path: ["items", "0"], value },
    ]);
    if (res.status !== "created") throw new Error(`createPatch: ${res.status}`);
  }
  const [first, second] = ["retry-1", "retry-2"] as PatchId[];
  system.stat.receiveStat({ patches: [], baseSha: "sha", profileId: ME });
  for (let i = 0; i < 20 && server.saves.length === 0; i++) await settle();
  expect(server.saves).toHaveLength(1);

  // The first attempt fails, and during the backoff -- no save in flight --
  // the user unstages the first write alone: an under-closed click.
  server.saves[0].answer({ status: "network-error", message: "offline" });
  await settle();
  click(system, { type: "unstage", patchIds: [first], withPatchIds: [] });
  await settle();
  errors.mockRestore();

  if (wake === null) throw new Error("the save was not retried");
  const retry: () => void = wake;
  retry();
  for (let i = 0; i < 20 && server.saves.length === 1; i++) await settle();
  expect(server.saves).toHaveLength(2);
  // Off the screen before the save goes, not only after the server answers.
  expect(system.patchGroup()).not.toContain(second);

  server.saves[1].answer();
  await settle();

  // The server ends with neither: never the second write over a hole.
  expect(server.members.has(first)).toBe(false);
  expect(server.members.has(second)).toBe(false);
  expect(system.patchGroup()).not.toContain(first);
  expect(system.patchGroup()).not.toContain(second);
});
