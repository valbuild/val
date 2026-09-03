import {
  initVal,
  type ModuleFilePath,
  type PatchId,
  type SourcePath,
} from "@valbuild/core";
import type { PatchGroupT } from "@valbuild/shared/internal";
import { createSystem } from "./createSystem";

/**
 * How the client learns WHICH group it is writing into, and when it stops
 * believing the answer.
 *
 * A write deliberately names no group: the content API resolves this author's
 * open one and creates it if absent, so on a fresh branch the group comes into
 * existence during the save and nowhere else. The chain annotation only
 * refreshes when a fetch has missing ids to ask for, and a patch this client
 * made is never missing — so if the save response is not read, the tab that
 * bootstrapped the group never learns its id and every stage is a silent no-op.
 *
 * The observability half is the same defect wearing a different hat: a store
 * that moves the groups without saying so is a screen that never repaints.
 */

const MODULE = "/a.val.ts" as ModuleFilePath;
const TITLE = '/a.val.ts?p="title"' as SourcePath;

const project = () => {
  const { c, s } = initVal();
  return [c.define(MODULE, s.object({ title: s.string() }), { title: "base" })];
};

const GROUP: PatchGroupT = {
  patchGroupId: "g1",
  authorId: "author-1",
  createdAt: "2026-01-01T00:00:00.000Z",
  publishedAt: null,
  patchIds: ["foreign" as PatchId],
};

function makeSystem(options?: {
  /** What the fake server says its save landed in. */
  savedInGroup?: string;
  /** Successive answers to `fetchPatches`, one per call. */
  fetchAnswers?: {
    patches: never[];
    patchGroups?: PatchGroupT[];
    errors?: Record<PatchId, string>;
  }[];
}) {
  const answers = [...(options?.fetchAnswers ?? [])];
  const system = createSystem({
    fetchPatches: async (patchIds) => {
      const next = answers.shift();
      if (next === undefined) {
        return { patches: [] };
      }
      return {
        ...next,
        errors:
          next.errors ??
          Object.fromEntries(
            patchIds.map((patchId) => [patchId, "not available in this test"]),
          ),
      };
    },
    createPatchId: (() => {
      let next = 0;
      return () => `p${++next}` as PatchId;
    })(),
    savePatches: async ({ patches, parentRef }) => ({
      status: "saved",
      newPatchIds: patches.map((patch) => patch.patchId),
      parentRef,
      // Spread, so "this deployment has no groups" is expressible as absence
      // rather than as an undefined-valued key.
      ...(options?.savedInGroup !== undefined
        ? { patchGroupId: options.savedInGroup }
        : {}),
    }),
    publishPatches: async () => ({ status: "published" }),
  });
  system.host.receive(project());
  system.stat.receiveStat({ patches: [], baseSha: "sha" });
  return system;
}

async function edit(
  system: ReturnType<typeof makeSystem>,
  value: string,
): Promise<void> {
  const res = await system.patchStore.createPatch(MODULE, [
    { op: "replace", path: ["title"], value },
  ]);
  if (res.status !== "created") {
    throw new Error(`createPatch failed: ${res.status}`);
  }
  await system.patchSync.flush();
}

test("the group the save landed in reaches the store", async () => {
  const system = makeSystem({ savedInGroup: "g1" });
  expect(system.patchStore.ownGroupId()).toBe(undefined);

  await edit(system, "edited");

  // The only place this id can come from. Nothing fetched, nothing was
  // annotated: the write created the group and the answer named it.
  expect(system.patchStore.ownGroupId()).toBe("g1");
  // And it is observable, which is a separate claim from being stored.
  expect(system.patchStore.groupsVersion()).toBeGreaterThan(0);
  // A read still works — this is not meant to disturb anything else.
  expect(system.sourceStore.peek(TITLE)).toMatchObject({
    status: "ready",
    data: "edited",
  });
});

test("a deployment without groups learns nothing, and says so", async () => {
  const system = makeSystem();
  await edit(system, "edited");

  // `fs` mode and any content API that predates groups answer without one.
  // Absence has to stay absence: a client that invented a group id here would
  // believe a publish is scoped when the server is not scoping anything.
  expect(system.patchStore.ownGroupId()).toBe(undefined);
  expect(system.patchStore.groupsVersion()).toBe(0);
});

test("re-announcing the same group does not move the version", async () => {
  const system = makeSystem({ savedInGroup: "g1" });
  await edit(system, "one");
  const afterFirst = system.patchStore.groupsVersion();

  await edit(system, "two");

  // The id arrives with EVERY save. Moving the version each time would repaint
  // the review screen once per keystroke batch for no news at all.
  expect(system.patchStore.ownGroupId()).toBe("g1");
  expect(system.patchStore.groupsVersion()).toBe(afterFirst);
});

test("a publish forgets the group, because a publish closes it", async () => {
  const system = makeSystem({ savedInGroup: "g1" });
  await edit(system, "edited");
  const beforePublish = system.patchStore.groupsVersion();
  expect(system.patchStore.ownGroupId()).toBe("g1");

  await system.publish([], "ship it");

  /*
   * Not merely stale — actively wrong. The content API refuses a write or a
   * stage into a published group, so keeping the id would answer every stage
   * with a 409 until something happened to re-fetch the annotation. The next
   * write creates the next group and its save response names it.
   */
  expect(system.patchStore.ownGroupId()).toBe(undefined);
  expect(system.patchStore.groupsVersion()).toBeGreaterThan(beforePublish);
});

test("groups arriving with no usable records are still observed", async () => {
  const system = makeSystem({
    fetchAnswers: [{ patches: [], patchGroups: [GROUP] }],
  });
  const before = system.patchStore.groupsVersion();

  // A foreign id the chain does not hold, so a fetch goes out — and comes back
  // with the annotation but nothing readable. The version used to move once per
  // DELIVERED record, so this response moved the groups and told nobody.
  system.stat.receiveStat({
    patches: ["foreign" as PatchId],
    baseSha: "sha",
  });
  await system.patchSync.flush();
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(system.patchStore.groups()).toEqual([GROUP]);
  expect(system.patchStore.groupsVersion()).toBeGreaterThan(before);
});

test("an unchanged annotation keeps its identity", async () => {
  const system = makeSystem({
    fetchAnswers: [
      { patches: [], patchGroups: [GROUP] },
      // A second fetch carrying an EQUAL but not identical annotation, which is
      // what every fetch after the first really carries.
      {
        patches: [],
        patchGroups: [{ ...GROUP, patchIds: [...GROUP.patchIds] }],
      },
    ],
  });

  system.stat.receiveStat({ patches: ["foreign" as PatchId], baseSha: "sha" });
  await system.patchSync.flush();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const first = system.patchStore.groups();
  const afterFirst = system.patchStore.groupsVersion();

  system.stat.receiveStat({ patches: ["foreign" as PatchId], baseSha: "sha" });
  await system.patchSync.flush();
  await new Promise((resolve) => setTimeout(resolve, 0));

  // Same array, so the memo downstream does not even re-run. A fresh object is
  // what makes everything downstream treat it as news.
  expect(system.patchStore.groups()).toBe(first);
  expect(system.patchStore.groupsVersion()).toBe(afterFirst);
});
