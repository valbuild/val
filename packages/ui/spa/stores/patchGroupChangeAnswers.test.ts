import {
  initVal,
  type ModuleFilePath,
  type PatchId,
  type SourcePath,
} from "@valbuild/core";
import type { PatchGroupT } from "@valbuild/shared/internal";
import { createSystem, type StagePatches } from "./createSystem";
import type { PatchRecord } from "./types";

/**
 * What the answer to a stage or unstage does to this tab — and to nothing
 * else.
 *
 * An answer belongs to the change that asked. It names the group the change
 * landed in (which `~` may just have created), it confirms the entries that
 * change put on screen and no later click's, and a refusal takes back exactly
 * what that change moved — even before the first groups have arrived to take
 * it back to.
 */

const A = "/a.val.ts" as ModuleFilePath;
const ME = "profile-me";
const THEM = "profile-them";
const P = "theirs" as PatchId;

const project = () => {
  const { c, s } = initVal();
  return [c.define(A, s.object({ title: s.string() }), { title: "base" })];
};

const record: PatchRecord = {
  patchId: P,
  moduleFilePath: A,
  patch: [{ op: "replace", path: ["title"], value: "theirs" }],
  createdAt: "2026-01-01T00:00:00.000Z",
  authorId: THEM,
  appliedAt: null,
};

function group(
  patchIds: PatchId[],
  patchGroupId = "g-mine",
  authorId = ME,
): PatchGroupT {
  return {
    patchGroupId,
    authorId,
    createdAt: "2026-01-01T00:00:00.000Z",
    publishedAt: null,
    patchIds,
  };
}

type Answer = Awaited<ReturnType<StagePatches>>;

/** A content API whose answers the test hands out one at a time. */
function makeSystem(options: { stat?: boolean } = {}) {
  const pending: { type: string; resolve: (answer: Answer) => void }[] = [];
  const publishes: { patchIds: PatchId[]; closesPatchGroupId?: string }[] = [];
  const ask =
    (type: string): StagePatches =>
    () =>
      new Promise((resolve) => pending.push({ type, resolve }));
  const system = createSystem({
    fetchPatches: async (patchIds) => ({
      patches: patchIds.includes(P) ? [record] : [],
    }),
    createPatchId: () => "local" as PatchId,
    stagePatches: ask("stage"),
    unstagePatches: ask("unstage"),
    publishPatches: async (request) => {
      publishes.push({
        patchIds: [...request.patchIds],
        ...(request.closesPatchGroupId !== undefined
          ? { closesPatchGroupId: request.closesPatchGroupId }
          : {}),
      });
      return { status: "published" };
    },
  });
  system.host.receive(project());
  system.stat.receiveStat({
    patches: [],
    baseSha: "sha",
    ...(options.stat === false ? {} : { profileId: ME }),
  });
  return Object.assign(system, { pending, publishes });
}

const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

async function stat(
  system: ReturnType<typeof makeSystem>,
  version: number,
  groups: PatchGroupT[],
): Promise<void> {
  system.stat.receiveStat({
    patches: [P],
    baseSha: "sha",
    headVersion: version,
    patchGroups: groups,
    profileId: ME,
  });
  await system.patchSync.flush();
  await settle();
}

function read(system: ReturnType<typeof makeSystem>): unknown {
  const peek = system.sourceStore.peek(`${A}?p="title"` as SourcePath);
  return peek.status === "ready" ? peek.data : peek.status;
}

function click(
  system: ReturnType<typeof makeSystem>,
  type: "stage" | "unstage",
): void {
  system.setPatchGroup(type === "stage" ? [P] : []);
  system.persistPatchGroupChange(undefined, {
    type,
    patchIds: [P],
    withPatchIds: [],
  });
}

async function answer(
  system: ReturnType<typeof makeSystem>,
  result: Answer,
): Promise<void> {
  await settle();
  const next = system.pending.shift();
  if (next === undefined) throw new Error("nothing was asked");
  next.resolve(result);
  await settle();
}

test("the group a stage into `~` created is the one a publish then closes", async () => {
  const system = makeSystem();
  system.seedPatchGroup([]);
  await stat(system, 1, [group([], "g-theirs", THEM)]);

  click(system, "stage");
  // The content API created this user's first group for the stage.
  await answer(system, {
    status: "ok",
    headVersion: 2,
    patchGroupId: "g-new",
  });

  // No stat in between: the publish goes out on what the answer said.
  expect(await system.publish([], "ship")).toMatchObject({
    status: "published",
  });
  expect(system.publishes).toEqual([
    { patchIds: [P], closesPatchGroupId: "g-new" },
  ]);
});

test("an older answer does not confirm a later click: stage, unstage, stage", async () => {
  const system = makeSystem();
  system.seedPatchGroup([]);
  await stat(system, 1, [group([])]);

  click(system, "stage");
  click(system, "unstage");
  click(system, "stage");
  expect(read(system)).toBe("theirs");

  // The first stage is answered, and a stat shows it.
  await answer(system, { status: "ok", headVersion: 2 });
  await stat(system, 2, [group([P])]);
  // The unstage is answered, and a stat shows that too — while the third
  // click, a stage, has not been answered yet.
  await answer(system, { status: "ok", headVersion: 3 });
  await stat(system, 3, [group([])]);

  // The last thing the user did was stage it.
  expect(read(system)).toBe("theirs");
  expect(system.patchGroup()).toContain(P);

  await answer(system, { status: "ok", headVersion: 4 });
  await stat(system, 4, [group([P])]);
  expect(system.patchGroup()).toContain(P);
});

test("a refused stage is taken back before the first groups have arrived", async () => {
  // No groups yet: the save that enabled them has answered, the stat that
  // brings them has not.
  const system = makeSystem({ stat: false });
  const errors = jest.spyOn(console, "error").mockImplementation(() => {});
  system.stat.receiveStat({ patches: [P], baseSha: "sha" });
  await system.patchSync.flush();
  await settle();
  system.seedPatchGroup([]);
  expect(system.patchStore.groups()).toBeUndefined();

  click(system, "stage");
  expect(read(system)).toBe("theirs");
  await answer(system, { status: "error", message: "refused in this test" });

  expect(system.patchGroup()).not.toContain(P);
  expect(read(system)).toBe("base");
  errors.mockRestore();
});

test.each([
  ["stage", "unstage", false],
  ["unstage", "stage", true],
] as const)(
  "%s then %s, both refused before the first groups: back where it started",
  async (first, second, startedIn) => {
    const system = makeSystem({ stat: false });
    const errors = jest.spyOn(console, "error").mockImplementation(() => {});
    system.stat.receiveStat({ patches: [P], baseSha: "sha" });
    await system.patchSync.flush();
    await settle();
    system.seedPatchGroup(startedIn ? [P] : []);
    expect(system.patchStore.groups()).toBeUndefined();

    click(system, first);
    click(system, second);
    await answer(system, { status: "error", message: "refused" });
    await answer(system, { status: "error", message: "refused" });

    expect(system.patchGroup()?.includes(P) ?? false).toBe(startedIn);
    expect(read(system)).toBe(startedIn ? "theirs" : "base");
    errors.mockRestore();
  },
);

test("a write whose closure moves membership is saved after the group changes made before it", async () => {
  const saves: PatchId[][] = [];
  const pending: ((answer: Answer) => void)[] = [];
  const system = createSystem({
    fetchPatches: async (patchIds) => ({
      patches: patchIds.includes(P) ? [record] : [],
    }),
    createPatchId: () => "mine" as PatchId,
    stagePatches: () => new Promise((resolve) => pending.push(resolve)),
    unstagePatches: () => new Promise((resolve) => pending.push(resolve)),
    savePatches: async ({ patches, parentRef }) => {
      saves.push(patches.map((patch) => patch.patchId));
      return {
        status: "saved",
        newPatchIds: patches.map((patch) => patch.patchId),
        parentRef,
      };
    },
  });
  system.host.receive(project());
  system.stat.receiveStat({ patches: [], baseSha: "sha", profileId: ME });
  system.seedPatchGroup([]);
  system.stat.receiveStat({
    patches: [P],
    baseSha: "sha",
    headVersion: 1,
    patchGroups: [group([P])],
    profileId: ME,
  });
  await system.patchSync.flush();
  await settle();
  // Every write's closure names P, as one written on top of P's insert would.
  system.setPatchGroupResolver(async () => ({ withPatchIds: [P] }));

  // P is unstaged, and the unstage is not answered yet.
  system.setPatchGroup([]);
  system.persistPatchGroupChange(undefined, {
    type: "unstage",
    patchIds: [P],
    withPatchIds: [],
  });
  await settle();
  expect(pending).toHaveLength(1);

  await system.patchStore.createPatch(A, [
    { op: "replace", path: ["title"], value: "mine" },
  ]);
  await settle();
  // The save waits: sent now, its closure could land before the unstage, and
  // the unstage would then take P out from under it.
  expect(saves).toEqual([]);

  pending[0]({ status: "ok", headVersion: 2 });
  await system.patchSync.flush();
  await settle();
  expect(saves).toEqual([["mine"]]);
});
