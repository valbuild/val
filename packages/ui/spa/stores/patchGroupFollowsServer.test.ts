import {
  initVal,
  type ModuleFilePath,
  type PatchId,
  type SourcePath,
} from "@valbuild/core";
import type { PatchGroupT } from "@valbuild/shared/internal";
import { createSystem } from "./createSystem";
import type { PatchRecord } from "./types";

/**
 * The scope follows the server's groups, as every stat reports them.
 *
 * The rule: a Studio that is in sync shows what a reload would. A reload builds
 * its scope from the server's groups, so an open Studio has to as well — every
 * time they move, whoever moved them. The content service announces every
 * write, stage, unstage and publish, every client re-stats, and the stat
 * carries the groups at the chain version it was read at.
 *
 * Over those groups lies what this tab has done that the server's groups may
 * not show yet (`unconfirmed` in `createSystem`). That is the only thing a tab
 * may show that a reload would not, and only until a stat new enough to include
 * it arrives.
 *
 * Asserted on what a reader sees, on what is held back, and on what a publish
 * ships — the three cannot come apart.
 */

const A = "/a.val.ts" as ModuleFilePath;
const B = "/b.val.ts" as ModuleFilePath;
const C = "/c.val.ts" as ModuleFilePath;
const ME = "profile-me";
const THEM = "profile-them";
const GROUP = "g-mine";

const project = () => {
  const { c, s } = initVal();
  return [
    c.define(A, s.object({ title: s.string() }), { title: "base a" }),
    c.define(B, s.object({ title: s.string() }), { title: "base b" }),
    c.define(C, s.object({ title: s.string() }), { title: "base c" }),
  ];
};

const titleOf = (module: ModuleFilePath) =>
  `${module}?p="title"` as SourcePath;

function record(
  patchId: string,
  module: ModuleFilePath,
  value: string,
  authorId = ME,
): PatchRecord {
  return {
    patchId: patchId as PatchId,
    moduleFilePath: module,
    patch: [{ op: "replace", path: ["title"], value }],
    createdAt: "2026-01-01T00:00:00.000Z",
    authorId,
    appliedAt: null,
  };
}

function group(
  patchIds: string[],
  options: { id?: string; authorId?: string | null; published?: boolean } = {},
): PatchGroupT {
  return {
    patchGroupId: options.id ?? GROUP,
    authorId: options.authorId === undefined ? ME : options.authorId,
    createdAt: "2026-01-01T00:00:00.000Z",
    publishedAt: options.published ? "2026-01-02T00:00:00.000Z" : null,
    patchIds: patchIds as PatchId[],
  };
}

function makeSystem(options?: {
  /** How the content API answers a stage or unstage. */
  groupChange?: "ok" | "refused";
  /** The chain version the content API answers a stage or unstage with. */
  changeVersion?: () => number;
  /** The chain version the content API answers a save with. */
  saveVersion?: () => number;
}) {
  const records = new Map<PatchId, PatchRecord>();
  const publishes: PatchId[][] = [];
  const system = createSystem({
    fetchPatches: async (patchIds) => ({
      patches: patchIds.flatMap((patchId) => {
        const found = records.get(patchId);
        return found ? [found] : [];
      }),
    }),
    createPatchId: (() => {
      let next = 0;
      return () => `mine-${++next}` as PatchId;
    })(),
    savePatches: async ({ patches, parentRef }) => ({
      status: "saved",
      newPatchIds: patches.map((patch) => patch.patchId),
      parentRef,
      ...(options?.saveVersion ? { headVersion: options.saveVersion() } : {}),
    }),
    publishPatches: async (request) => {
      publishes.push([...request.patchIds]);
      return { status: "published" };
    },
    stagePatches: async () =>
      options?.groupChange === "refused"
        ? { status: "error", message: "refused in this test" }
        : {
            status: "ok",
            ...(options?.changeVersion
              ? { headVersion: options.changeVersion() }
              : {}),
          },
    unstagePatches: async () =>
      options?.groupChange === "refused"
        ? { status: "error", message: "refused in this test" }
        : {
            status: "ok",
            ...(options?.changeVersion
              ? { headVersion: options.changeVersion() }
              : {}),
          },
  });
  system.host.receive(project());
  system.stat.receiveStat({ patches: [], baseSha: "sha", profileId: ME });
  return Object.assign(system, { records, publishes });
}

type TestSystem = ReturnType<typeof makeSystem>;

/** A stat, and the fetch it triggers for anything not held yet. */
async function stat(
  system: TestSystem,
  version: number,
  patchIds: string[],
  groups: PatchGroupT[],
): Promise<void> {
  system.stat.receiveStat({
    patches: patchIds as PatchId[],
    baseSha: "sha",
    headVersion: version,
    patchGroups: groups,
    profileId: ME,
  });
  await system.patchSync.flush();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function read(system: TestSystem, module: ModuleFilePath): unknown {
  const peek = system.sourceStore.peek(titleOf(module));
  return peek.status === "ready" ? peek.data : peek.status;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** What the shell does once it knows this user has groups: scope the tab. */
function scope(system: TestSystem): void {
  system.seedPatchGroup([]);
}

test("a write from another browser into my group shows, and publishes", async () => {
  const system = makeSystem();
  system.records.set("other-tab" as PatchId, record("other-tab", A, "there"));
  scope(system);

  await stat(system, 1, ["other-tab"], [group(["other-tab"])]);

  expect(read(system, A)).toBe("there");
  expect(system.patchStore.unstagedPatchIds().has("other-tab" as PatchId)).toBe(
    false,
  );
  expect(await system.publish([], "ship")).toMatchObject({
    status: "published",
  });
  expect(system.publishes).toEqual([["other-tab"]]);
});

test("the user's group is found from the profile the stat names, with no help from the shell", async () => {
  // No `setOwnPatchGroupId`: the stat says who is asking, which is enough.
  const system = makeSystem();
  system.records.set("other-tab" as PatchId, record("other-tab", A, "there"));
  scope(system);

  await stat(
    system,
    1,
    ["other-tab"],
    [group([], { id: "g-theirs", authorId: THEM }), group(["other-tab"])],
  );

  expect(read(system, A)).toBe("there");
});

test("an UNSTAGE made in another browser is unstaged here too", async () => {
  const system = makeSystem();
  system.records.set("p" as PatchId, record("p", A, "staged"));
  scope(system);
  await stat(system, 1, ["p"], [group(["p"])]);
  expect(read(system, A)).toBe("staged");

  await stat(system, 2, ["p"], [group([])]);

  expect(read(system, A)).toBe("base a");
  expect(system.patchStore.unstagedPatchIds().has("p" as PatchId)).toBe(true);
  expect((await system.publish([], "ship")).status).not.toBe("published");
});

test("a STAGE of a colleague's change made in another browser shows here too", async () => {
  const system = makeSystem();
  system.records.set("theirs" as PatchId, record("theirs", B, "theirs", THEM));
  scope(system);
  await stat(
    system,
    1,
    ["theirs"],
    [group([]), group(["theirs"], { id: "g-theirs", authorId: THEM })],
  );
  expect(read(system, B)).toBe("base b");

  await stat(
    system,
    2,
    ["theirs"],
    [group(["theirs"]), group(["theirs"], { id: "g-theirs", authorId: THEM })],
  );

  expect(read(system, B)).toBe("theirs");
});

test("another author's group is never taken for mine, nor one with no author", async () => {
  const system = makeSystem();
  system.records.set("theirs" as PatchId, record("theirs", B, "theirs", THEM));
  system.records.set("anon" as PatchId, record("anon", C, "anon"));
  scope(system);

  await stat(
    system,
    1,
    ["theirs", "anon"],
    [
      group(["theirs"], { id: "g-theirs", authorId: THEM }),
      group(["anon"], { id: "g-anon", authorId: null }),
    ],
  );

  expect(read(system, B)).toBe("base b");
  expect(read(system, C)).toBe("base c");
});

test("a local unstage survives a stat read before the server had it", async () => {
  let version = 2;
  const system = makeSystem({ changeVersion: () => ++version });
  system.records.set("p" as PatchId, record("p", A, "staged"));
  scope(system);
  await stat(system, 2, ["p"], [group(["p"])]);

  // Unstaged here, the way the review screen does it.
  system.setPatchGroup([]);
  system.persistPatchGroupChange(GROUP, {
    type: "unstage",
    patchIds: ["p" as PatchId],
    withPatchIds: [],
  });
  expect(read(system, A)).toBe("base a");

  // A stat that was read before the unstage landed still lists it. Without the
  // version it would put the patch back on screen and into the next publish.
  system.stat.receiveStat({
    patches: ["p" as PatchId],
    baseSha: "sha",
    headVersion: 2,
    patchGroups: [group(["p"])],
    profileId: ME,
  });
  await settle();
  expect(read(system, A)).toBe("base a");

  // The server's answer (version 3) and then a stat that includes it.
  await stat(system, 3, ["p"], [group([])]);
  expect(read(system, A)).toBe("base a");
});

test("a change unstaged here and re-staged in another browser shows here", async () => {
  let version = 2;
  const system = makeSystem({ changeVersion: () => ++version });
  system.records.set("p" as PatchId, record("p", A, "back and forth"));
  scope(system);
  await stat(system, 2, ["p"], [group(["p"])]);
  system.setPatchGroup([]);
  system.persistPatchGroupChange(GROUP, {
    type: "unstage",
    patchIds: ["p" as PatchId],
    withPatchIds: [],
  });
  await settle();
  await stat(system, 3, ["p"], [group([])]);
  expect(read(system, A)).toBe("base a");

  // Re-staged elsewhere. This tab's unstage was confirmed at version 3 and is
  // older than this stat, so it no longer stands in the way.
  await stat(system, 4, ["p"], [group(["p"])]);

  expect(read(system, A)).toBe("back and forth");
});

test("this tab's own write stays on screen until a stat includes it", async () => {
  const system = makeSystem({ saveVersion: () => 5 });
  scope(system);
  await stat(system, 4, [], [group([])]);

  const created = await system.patchStore.createPatch(A, [
    { op: "replace", path: ["title"], value: "typed here" },
  ]);
  if (created.status !== "created") throw new Error(created.status);
  const mine = created.record.patchId;
  expect(read(system, A)).toBe("typed here");

  // The groups are read again before the save is answered — at the version
  // this tab already had — and do not list the write yet.
  system.patchStore.receiveStatGroups([group([])], 4);
  expect(read(system, A)).toBe("typed here");

  await system.patchSync.flush();
  await stat(system, 5, [mine], [group([mine])]);
  expect(read(system, A)).toBe("typed here");
  expect(await system.publish([], "ship")).toMatchObject({
    status: "published",
  });
  expect(system.publishes).toEqual([[mine]]);
});

test("a stage the server refused is taken back off the screen", async () => {
  const system = makeSystem({ groupChange: "refused" });
  const errors = jest.spyOn(console, "error").mockImplementation(() => {});
  system.records.set("theirs" as PatchId, record("theirs", B, "theirs", THEM));
  scope(system);
  await stat(system, 1, ["theirs"], [group([])]);

  system.setPatchGroup(["theirs" as PatchId]);
  system.persistPatchGroupChange(GROUP, {
    type: "stage",
    patchIds: ["theirs" as PatchId],
    withPatchIds: [],
  });
  expect(read(system, B)).toBe("theirs");
  await settle();

  // What the server holds, which is what a reload would show.
  expect(read(system, B)).toBe("base b");
  expect(system.patchGroup()).not.toContain("theirs");
  errors.mockRestore();
});

test("a group the stats show published is not followed", async () => {
  const system = makeSystem();
  system.records.set("p" as PatchId, record("p", A, "shipped elsewhere"));
  scope(system);

  await stat(system, 1, ["p"], [group(["p"], { published: true })]);

  expect(system.patchGroup()).not.toContain("p");
});

test("an unscoped client is left unscoped", async () => {
  // fs mode, or groups not turned on: everything shows, and following a group
  // would turn "everything" into "this".
  const system = makeSystem();
  system.records.set("p" as PatchId, record("p", A, "pending"));

  await stat(system, 1, ["p"], [group([])]);

  expect(system.patchGroup()).toBe(null);
  expect(read(system, A)).toBe("pending");
});
