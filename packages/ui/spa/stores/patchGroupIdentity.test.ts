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
  /** What each publish told the server it was closing. */
  const publishes: { closesPatchGroupId: string | undefined }[] = [];
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
    publishPatches: async (request) => {
      publishes.push({ closesPatchGroupId: request.closesPatchGroupId });
      return { status: "published" };
    },
  });
  system.host.receive(project());
  system.stat.receiveStat({ patches: [], baseSha: "sha" });
  return Object.assign(system, { publishes });
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

test("a publish does not make the deployment look like one without groups", async () => {
  const system = makeSystem({ savedInGroup: "g1" });
  await edit(system, "edited");
  expect(system.patchStore.patchGroupsSupported()).toBe(true);

  await system.publish([], "ship it");

  /*
   * The id is gone — a publish closes the group — but "this deployment has
   * patch groups" is a fact about the deployment and cannot stop being true.
   *
   * They used to be the same answer: the annotation is ABSENT rather than
   * empty when no group holds anything, so on a single-author branch the
   * publish left both unset and the client concluded there were no groups
   * here. `useCurrentPatchGroup` then reported `enabled: false`, which turns
   * the staging controls off AND makes `usePatchGroupWrites` drop the write
   * resolver — so every patch written between that publish and the next page
   * load joined no group at all.
   */
  expect(system.patchStore.ownGroupId()).toBe(undefined);
  expect(system.patchStore.patchGroupsSupported()).toBe(true);
});

test("a deployment that never mentions a group is not reported as having them", async () => {
  const system = makeSystem();
  await edit(system, "edited");

  // `fs` mode, or a content API that predates groups. Latching on the first
  // sighting must not mean latching on nothing.
  expect(system.patchStore.patchGroupsSupported()).toBe(false);
});

test("the annotation alone is enough to know groups exist here", async () => {
  const system = makeSystem({
    fetchAnswers: [{ patches: [], patchGroups: [GROUP] }],
  });
  expect(system.patchStore.patchGroupsSupported()).toBe(false);

  // Somebody else's group, on a branch this client has not written to. It still
  // proves the deployment has them.
  system.stat.receiveStat({ patches: ["foreign" as PatchId], baseSha: "sha" });
  await system.patchSync.flush();
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(system.patchStore.patchGroupsSupported()).toBe(true);
});

/** Deliver an annotation, which only a fetch for a MISSING id can carry. */
async function deliverGroups(
  system: ReturnType<typeof makeSystem>,
): Promise<void> {
  // `p1` is listed alongside it: stat is authoritative about what the chain
  // holds, so leaving this tab's own patch out of it drops the patch.
  system.stat.receiveStat({
    patches: ["foreign" as PatchId, "p1" as PatchId],
    baseSha: "sha",
  });
  await system.patchSync.flush();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const openGroup = (patchIds: PatchId[]): PatchGroupT => ({
  patchGroupId: "g1",
  authorId: "author-1",
  createdAt: "2026-01-01T00:00:00.000Z",
  publishedAt: null,
  patchIds,
});

test("a publish closes the published group in the ANNOTATION too", async () => {
  const system = makeSystem({
    savedInGroup: "g1",
    fetchAnswers: [
      { patches: [], patchGroups: [openGroup(["p1" as PatchId])] },
    ],
  });
  await edit(system, "edited");
  await deliverGroups(system);
  expect(system.patchStore.groups()?.[0].publishedAt).toBeNull();

  const res = await system.publish([], "ship it");
  expect(res.status).toBe("published");

  /*
   * Forgetting `ownGroupId` was only half of it. Nothing refetches the
   * annotation — `forgetPublished` drops the published ids from `dataById`, so
   * the next `/stat` that re-lists them (they stay in the chain until the
   * deploy) files them as stale and asks for nothing — so the client went on
   * believing g1 was open. Every stage in the review screen was then sent to a
   * closed group and refused with 409, and the deferred queue never engaged
   * because there appeared to be a group to send to.
   */
  expect(system.patchStore.groups()?.[0].publishedAt).not.toBeNull();
});

test("a group holding another TAB's work is not closed", async () => {
  const system = makeSystem({
    savedInGroup: "g1",
    fetchAnswers: [
      {
        patches: [],
        // The annotation knows about `other`; this tab's scope never will,
        // because the scope grows only on this tab's own writes.
        patchGroups: [openGroup(["p1" as PatchId, "other" as PatchId])],
      },
    ],
  });
  await edit(system, "edited");
  await deliverGroups(system);
  // What the shell does from `useCurrentPatchGroup`, which is the only place
  // that can resolve whose group this is.
  system.setOwnPatchGroupId("g1");
  system.setPatchGroup(["p1" as PatchId]);

  expect((await system.publish([], "ship my half")).status).toBe("published");

  /*
   * Deciding from the local scope alone passed the "does this empty the group"
   * check and NAMED the group on the commit — and the content API closes what
   * it is named without looking. `other` would have fallen into a closed group
   * and out of the next one, and the other tab's next stage into that id would
   * have been a 409.
   *
   * Asserted on what went to the server, not on the local annotation: the
   * client-side close in `markPublished` has its own rule and would leave the
   * group open here either way, so it cannot tell the two apart.
   */
  expect(system.publishes).toHaveLength(1);
  expect(system.publishes[0].closesPatchGroupId).toBe(undefined);
});

test("no annotation still names the group, on the strength of the scope", async () => {
  /*
   * Refusing without an annotation sounds safer and is not.
   *
   * On a single-author branch nothing is ever missing from the chain, so no
   * fetch is made, so no annotation ever arrives — and the group would never
   * close on exactly the branches where that matters most, which is the bug
   * `patchGroupId` on commit was added to fix. The test above is the case where
   * the annotation exists and disagrees; this is the case where there is
   * nothing to disagree with.
   */
  const system = makeSystem({ savedInGroup: "g1" });
  await edit(system, "edited");
  system.setOwnPatchGroupId("g1");
  system.setPatchGroup(["p1" as PatchId]);

  expect((await system.publish([], "ship it")).status).toBe("published");

  expect(system.publishes[0].closesPatchGroupId).toBe("g1");
});

test("a publish that DOES empty the group names it", async () => {
  // The positive control. Without it the test above passes for any reason at
  // all, including a `closesPatchGroupId` that is never sent.
  const system = makeSystem({
    savedInGroup: "g1",
    fetchAnswers: [
      { patches: [], patchGroups: [openGroup(["p1" as PatchId])] },
    ],
  });
  await edit(system, "edited");
  await deliverGroups(system);
  system.setOwnPatchGroupId("g1");
  system.setPatchGroup(["p1" as PatchId]);

  expect((await system.publish([], "ship all of it")).status).toBe("published");

  expect(system.publishes[0].closesPatchGroupId).toBe("g1");
});

test("a PARTIAL publish leaves the group open", async () => {
  const system = makeSystem({
    savedInGroup: "g1",
    fetchAnswers: [
      {
        patches: [],
        // The server put a second patch in the group that this publish does not
        // ship — another tab of the same author, typically.
        patchGroups: [openGroup(["p1" as PatchId, "p2" as PatchId])],
      },
    ],
  });
  await edit(system, "edited");
  await deliverGroups(system);

  expect((await system.publish([], "only part of it")).status).toBe(
    "published",
  );

  /*
   * ALL of a group's ids, not any. A partial publish leaves the group open on
   * the server with only some of its patches applied, so closing it here would
   * hide a group its owner can still add to — and send their next stage down
   * the deferred path forever.
   */
  expect(system.patchStore.groups()?.[0].publishedAt).toBeNull();
});
