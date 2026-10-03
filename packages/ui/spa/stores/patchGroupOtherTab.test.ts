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
 * A change written in ANOTHER tab or browser, by the same user, reaches this
 * one.
 *
 * The server puts every write in its author's open group, wherever it was
 * typed. This tab hears about it the ordinary way — `/stat` names an id it does
 * not have, the fetch brings the record and, in the same response, the group
 * annotation listing the new id in our open group. What used to happen next is
 * the bug: the scope had been seeded once at load and grew only on this tab's
 * own writes, so `SourceStore` held the patch as unstaged. Not on screen here
 * until a reload, and left out of a publish from here — while the server had
 * it in the very group that publish was about to close.
 *
 * Asserted against the real `createSystem` graph with a fake content API, on
 * what a reader sees and on what reaches `POST /publish`: the two halves have
 * to move together, which is the whole point of the scope.
 */

const MODULE = "/a.val.ts" as ModuleFilePath;
const OTHER = "/b.val.ts" as ModuleFilePath;
const TITLE = '/a.val.ts?p="title"' as SourcePath;
const ME = "author-me";

const project = () => {
  const { c, s } = initVal();
  return [
    c.define(MODULE, s.object({ title: s.string() }), { title: "base" }),
    c.define(OTHER, s.object({ title: s.string() }), { title: "base B" }),
  ];
};

const elsewhere = "from-safari" as PatchId;

function recordOf(patchId: PatchId, value: string): PatchRecord {
  return {
    patchId,
    moduleFilePath: MODULE,
    patch: [{ op: "replace", path: ["title"], value }],
    createdAt: "2026-01-01T00:00:00.000Z",
    authorId: ME,
    appliedAt: null,
  };
}

function group(
  patchGroupId: string,
  authorId: string | null,
  patchIds: PatchId[],
): PatchGroupT {
  return {
    patchGroupId,
    authorId,
    createdAt: "2026-01-01T00:00:00.000Z",
    publishedAt: null,
    patchIds,
  };
}

function makeSystem(options: {
  /** The annotation a fetch carries. Replace it to change the next answer. */
  annotation: PatchGroupT[];
  /** What the new patch sets the title to. */
  value?: string;
}) {
  const publishes: PatchId[][] = [];
  const server = {
    annotation: options.annotation,
    records: new Map<PatchId, PatchRecord>([
      [elsewhere, recordOf(elsewhere, options.value ?? "typed in safari")],
    ]),
  };
  const system = createSystem({
    fetchPatches: async (patchIds) => ({
      patches: patchIds.flatMap((patchId) => {
        const record = server.records.get(patchId);
        return record ? [record] : [];
      }),
      patchGroups: server.annotation,
    }),
    createPatchId: (() => {
      let next = 0;
      return () => `p${++next}` as PatchId;
    })(),
    savePatches: async ({ patches, parentRef }) => ({
      status: "saved",
      newPatchIds: patches.map((patch) => patch.patchId),
      parentRef,
      patchGroupId: "g-mine",
    }),
    publishPatches: async (request) => {
      publishes.push([...request.patchIds]);
      return { status: "published" };
    },
  });
  system.host.receive(project());
  system.stat.receiveStat({ patches: [], baseSha: "sha" });
  return Object.assign(system, { publishes, server });
}

/** `/stat` announces the patch, and the fetch it triggers has landed. */
async function arrive(
  system: ReturnType<typeof makeSystem>,
  patchIds: PatchId[],
): Promise<void> {
  system.stat.receiveStat({ patches: patchIds, baseSha: "sha" });
  await system.patchSync.flush();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const held = new Set(
    system.patchStore.allRecords().map((record) => record.patchId),
  );
  if (!patchIds.every((patchId) => held.has(patchId))) {
    throw new Error("the fetch never delivered the record");
  }
}

function read(system: ReturnType<typeof makeSystem>): unknown {
  const peek = system.sourceStore.peek(TITLE);
  return peek.status === "ready" ? peek.data : peek.status;
}

/** What the shell does on load, from `useCurrentPatchGroup`. */
function scopeTab(system: ReturnType<typeof makeSystem>, ownGroup: string) {
  system.setOwnPatchGroupId(ownGroup);
  system.seedPatchGroup([]);
}

test("a patch written in another tab into MY open group shows up, and publishes", async () => {
  const system = makeSystem({
    annotation: [group("g-mine", ME, [elsewhere])],
  });
  scopeTab(system, "g-mine");
  expect(read(system)).toBe("base");

  await arrive(system, [elsewhere]);

  expect(read(system)).toBe("typed in safari");
  expect(system.patchStore.unstagedPatchIds().has(elsewhere)).toBe(false);
  expect(system.patchGroup()).toContain(elsewhere);

  // What is on screen is what ships.
  expect((await system.publish([], "ship it")).status).toBe("published");
  expect(system.publishes).toEqual([[elsewhere]]);
});

test("it shows up when the shell learns the group id only AFTER the annotation", async () => {
  /*
   * The other tab's write can be what CREATED the group, so the annotation
   * naming it arrives before this tab's `useCurrentPatchGroup` has an id to
   * hand the system. The adoption has to happen when the id does arrive, or
   * the patch stays unstaged until a reload.
   */
  const system = makeSystem({
    annotation: [group("g-mine", ME, [elsewhere])],
  });
  system.seedPatchGroup([]);

  await arrive(system, [elsewhere]);
  expect(read(system)).toBe("base");

  system.setOwnPatchGroupId("g-mine");

  expect(read(system)).toBe("typed in safari");
  expect(system.patchStore.unstagedPatchIds().has(elsewhere)).toBe(false);
});

test("a patch in ANOTHER author's group stays unstaged", async () => {
  const system = makeSystem({
    annotation: [
      group("g-mine", ME, []),
      group("g-theirs", "author-someone-else", [elsewhere]),
    ],
    value: "someone else's",
  });
  scopeTab(system, "g-mine");

  await arrive(system, [elsewhere]);

  expect(read(system)).toBe("base");
  expect(system.patchStore.unstagedPatchIds().has(elsewhere)).toBe(true);
  expect(system.patchGroup()).not.toContain(elsewhere);
});

test("a group with NO author is never adopted from, even when it is the one named", async () => {
  /*
   * An api-key or PAT write. `useCurrentPatchGroup` would never name it, but the
   * store does not take that on trust: adopting from it would stage a
   * stranger's work into this user's publish.
   */
  const system = makeSystem({
    annotation: [group("g-anon", null, [elsewhere])],
  });
  scopeTab(system, "g-anon");

  await arrive(system, [elsewhere]);

  expect(read(system)).toBe("base");
  expect(system.patchStore.unstagedPatchIds().has(elsewhere)).toBe(true);
});

test("a group the annotation shows PUBLISHED is not adopted from", async () => {
  const system = makeSystem({
    annotation: [
      { ...group("g-mine", ME, [elsewhere]), publishedAt: "2026-01-02" },
    ],
  });
  scopeTab(system, "g-mine");

  await arrive(system, [elsewhere]);

  expect(system.patchGroup()).not.toContain(elsewhere);
});

test("an unscoped tab is left unscoped", async () => {
  // `null` is fs mode and a content API without groups: everything is already
  // visible, and adopting would turn "show everything" into "show this".
  const system = makeSystem({
    annotation: [group("g-mine", ME, [elsewhere])],
  });
  system.setOwnPatchGroupId("g-mine");

  await arrive(system, [elsewhere]);

  expect(system.patchGroup()).toBe(null);
  expect(read(system)).toBe("typed in safari");
});

test("a patch this tab UNSTAGED stays unstaged when a stale annotation still lists it", async () => {
  /*
   * The unstage removes the patch from the group on the server too — but a
   * fetch whose response was read before that landed still lists it. The
   * annotation is routinely older than the last click, and putting back what
   * the user just took out is the dangerous direction: the next publish ships
   * it.
   */
  const later = "later" as PatchId;
  const system = makeSystem({
    annotation: [group("g-mine", ME, [elsewhere])],
  });
  scopeTab(system, "g-mine");
  await arrive(system, [elsewhere]);
  expect(system.patchGroup()).toContain(elsewhere);

  // The user unstages it here.
  system.setPatchGroup(
    (system.patchGroup() ?? []).filter((patchId) => patchId !== elsewhere),
  );
  expect(read(system)).toBe("base");

  // A third tab writes something else into the group — in another module, so
  // it does not depend on the unstaged patch — and the fetch that brings it
  // carries an annotation that still lists the unstaged patch.
  system.server.records.set(later, {
    ...recordOf(later, "typed later"),
    moduleFilePath: OTHER,
  });
  system.server.annotation = [group("g-mine", ME, [elsewhere, later])];
  const groupsBefore = system.patchStore.groupsVersion();
  await arrive(system, [elsewhere, later]);
  // The annotation really did move, so adoption really did run.
  expect(system.patchStore.groupsVersion()).toBeGreaterThan(groupsBefore);
  // And the shell re-announcing the id changes nothing either.
  system.setOwnPatchGroupId("g-mine");

  // The new write is adopted; the unstaged one is not.
  expect(system.patchGroup()).toContain(later);
  expect(system.patchGroup()).not.toContain(elsewhere);
  expect(system.patchStore.unstagedPatchIds().has(elsewhere)).toBe(true);

  expect(await system.publish([], "ship the rest")).toMatchObject({
    status: "published",
  });
  expect(system.publishes).toEqual([[later]]);
});
