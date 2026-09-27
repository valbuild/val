import { initVal, type ModuleFilePath, type PatchId } from "@valbuild/core";
import type { ParentRef } from "@valbuild/core/patch";
import { createSystem, type System } from "./createSystem";
import type { PatchRecord } from "./types";

/**
 * A write names the HEAD of the server's chain as its parent — the head the
 * server reports — and not the last patch this client was shown.
 *
 * The two differ for good once patch groups are in play. `/stat` lists the
 * pending chain minus what the running deployment already contains, and a
 * group publish can ship LATER patches while an earlier one stays pending:
 * another author's edit that nets to nothing can never be published at all.
 * The list then ends at that pending patch, the head is a published patch the
 * list leaves out, and a write naming the last listed id is refused on every
 * retry — a re-sync returns the same list. What fixed it in the Studio was
 * discarding the other author's change, which empties the list.
 *
 * The fake server below keeps the chain the way the content service does: rows
 * in order, each either pending or published, a listing that hides the
 * published ones (as a deployment that contains them is shown), and a write
 * accepted only on the head.
 */

const MODULE = "/a.val.ts" as ModuleFilePath;
const project = () => {
  const { c, s } = initVal();
  return [
    c.define(MODULE, s.object({ title: s.string(), body: s.string() }), {
      title: "base",
      body: "base",
    }),
  ];
};

type Row = { patchId: PatchId; published: boolean };

function makeServer(options: {
  rows: Row[];
  /** A content service that predates `headPatchId` reports none. */
  reportsHead?: boolean;
  /**
   * Version the chain, as the content service does (`headVersion`): bumped by
   * every change to it, and reported with the head. Off by default: the tests
   * above are about a server that sends a head and nothing to order it by.
   */
  versions?: boolean;
}) {
  const rows = [...options.rows];
  const reportsHead = options.reportsHead ?? true;
  const versions = options.versions ?? false;
  const writes: ParentRef[] = [];
  let version = 1;
  /** The chain changed. */
  const bump = () => (version += 1);
  const head = (): PatchId | null => rows[rows.length - 1]?.patchId ?? null;
  const shown = () =>
    rows.filter((row) => !row.published).map((row) => row.patchId);
  const snapshot = () => ({
    patches: shown(),
    baseSha: "sha",
    ...(reportsHead ? { headPatchId: head() } : {}),
    ...(versions ? { headVersion: version } : {}),
  });
  return {
    rows,
    writes,
    head,
    snapshot,
    versions,
    bump,
    /** A discard: the row is deleted, and the head can move BACK. */
    discard(patchId: string) {
      const index = rows.findIndex((row) => row.patchId === patchId);
      if (index !== -1) rows.splice(index, 1);
      bump();
    },
    /** Somebody else's pending patch. */
    writeElsewhere(patchId: string) {
      rows.push({ patchId: patchId as PatchId, published: false });
      bump();
    },
    /** Somebody else's patch, published and deployed: in the chain, not shown. */
    publishElsewhere(patchId: string) {
      rows.push({ patchId: patchId as PatchId, published: true });
      bump();
    },
  };
}

const foreign = (patchId: string): PatchRecord => ({
  patchId: patchId as PatchId,
  moduleFilePath: MODULE,
  patch: [{ op: "replace", path: ["body"], value: patchId }],
  createdAt: "2026-01-01T00:00:00.000Z",
  authorId: "someone-else",
  appliedAt: null,
});

function makeSystem(server: ReturnType<typeof makeServer>): System {
  const records = server.rows.map((row) => foreign(row.patchId));
  // Read by `resyncChain` only once a write has run, long after this is set.
  const system: System = createSystem({
    fetchPatches: async (patchIds) => ({
      patches: records.filter((record) => patchIds.includes(record.patchId)),
      // The server still holds this client's own saves. Answered as an error
      // rather than a record only because the rig keeps no ops for them — an
      // error is "could not read it", which is never taken for "gone".
      errors: Object.fromEntries(
        patchIds
          .filter(
            (patchId) =>
              !records.some((record) => record.patchId === patchId) &&
              server.rows.some((row) => row.patchId === patchId),
          )
          .map((patchId) => [patchId, "held by the server"]),
      ),
    }),
    createPatchId: (() => {
      let next = 0;
      return () => `mine-${++next}` as PatchId;
    })(),
    savePatches: async ({ patches, parentRef }) => {
      server.writes.push(parentRef);
      // The content service's rule: a parent is accepted only when it IS the
      // head, and no parent only when nothing is pending.
      const head = server.head();
      const accepted =
        parentRef.type === "patch"
          ? parentRef.patchId === head
          : server.rows.every((row) => row.published);
      if (!accepted) {
        return { status: "conflict", message: "not the head" };
      }
      for (const patch of patches) {
        server.rows.push({ patchId: patch.patchId, published: false });
      }
      const madeVersion = server.bump();
      return {
        status: "saved",
        newPatchIds: patches.map((patch) => patch.patchId),
        parentRef: {
          type: "patch",
          patchId: patches[patches.length - 1].patchId,
        },
        // The version this write made, as the content service reports it.
        ...(server.versions ? { headVersion: madeVersion } : {}),
      };
    },
    resyncChain: async () => {
      system.stat.receiveStat(server.snapshot());
    },
    publishPatches: async () => ({ status: "published" }),
    saveBackoffMs: () => 0,
  });
  system.host.receive(project());
  system.stat.receiveStat(server.snapshot());
  return system;
}

/**
 * Drain the write queue, or fail — never hang.
 *
 * A write refused for good is RETRIED for good (that is the bug this file
 * pins), and with no backoff in the rig a bare `flush()` then never settles. A
 * regression has to show up as a failing test rather than a stuck run, so the
 * wait has a deadline, and missing it stops the loop and says why.
 */
async function flush(system: System): Promise<void> {
  const settled = await Promise.race([
    system.patchSync.flush().then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2000)),
  ]);
  if (!settled) {
    system.dispose();
    throw new Error(
      "The write never landed: the server kept refusing the parent. " +
        JSON.stringify(system.patchSync.currentState()),
    );
  }
}

async function edit(system: System, value: string): Promise<PatchId> {
  const res = await system.patchStore.createPatch(MODULE, [
    { op: "replace", path: ["title"], value },
  ]);
  if (res.status !== "created") {
    throw new Error(`createPatch failed: ${res.status}`);
  }
  return res.record.patchId;
}

/*
 * The incident: another author's pending patch, then somebody else's later
 * work, published and deployed.
 */
const incident = () => [
  { patchId: "theirs-pending" as PatchId, published: false },
  { patchId: "elsewhere-published" as PatchId, published: true },
];

describe("the parent is the head the server reports", () => {
  test("a write lands first time when the head is a patch the list leaves out", async () => {
    const server = makeServer({ rows: incident() });
    const system = makeSystem(server);

    await edit(system, "mine");
    await flush(system);

    expect(server.writes).toEqual([
      { type: "patch", patchId: "elsewhere-published" },
    ]);
    expect(system.patchSync.currentState()).toMatchObject({
      status: "in-sync",
    });
    system.dispose();
  });

  test("a reported empty chain is written with no parent, not the last listed id", async () => {
    const server = makeServer({ rows: [] });
    const system = makeSystem(server);

    await edit(system, "mine");
    await flush(system);

    expect(server.writes).toEqual([{ type: "head", headBaseSha: "sha" }]);
    system.dispose();
  });

  test("the next write names the patch this client just saved", async () => {
    const server = makeServer({ rows: incident() });
    const system = makeSystem(server);

    const first = await edit(system, "one");
    await flush(system);
    await edit(system, "two");
    await flush(system);

    expect(server.writes).toEqual([
      { type: "patch", patchId: "elsewhere-published" },
      { type: "patch", patchId: first },
    ]);
    system.dispose();
  });

  test("a head that moved out of sight is picked up by the re-sync after a 409", async () => {
    const server = makeServer({ rows: incident() });
    const system = makeSystem(server);
    // Another publish lands after this client's last stat.
    server.publishElsewhere("elsewhere-later");

    await edit(system, "mine");
    await flush(system);

    expect(server.writes).toEqual([
      { type: "patch", patchId: "elsewhere-published" },
      { type: "patch", patchId: "elsewhere-later" },
    ]);
    expect(system.patchSync.currentState()).toMatchObject({
      status: "in-sync",
    });
    system.dispose();
  });

  test("a stat whose head is our own unlisted save lets a later head win", async () => {
    // Our save is published and deployed before the next stat, so that stat
    // lists nothing of ours and reports our patch as the head. Then somebody
    // else publishes on top. The parent has to follow the head, not stay on our
    // own patch because no stat ever LISTED it.
    const server = makeServer({ rows: [] });
    const system = makeSystem(server);
    await edit(system, "one");
    await flush(system);
    for (const row of server.rows) row.published = true;
    system.stat.receiveStat(server.snapshot());
    server.publishElsewhere("elsewhere-later");
    system.stat.receiveStat(server.snapshot());

    await edit(system, "two");
    await flush(system);

    expect(server.writes).toEqual([
      { type: "head", headBaseSha: "sha" },
      { type: "patch", patchId: "elsewhere-later" },
    ]);
    system.dispose();
  });
});

describe("our own saves, and a stat that has seen past them", () => {
  test("a head written after our save, with our save left out of the list, wins", async () => {
    // Our save is published and deployed — so the list leaves it out — and
    // somebody else writes on top before the next stat. That stat names their
    // patch as the head and does not mention ours; the parent follows the head.
    const server = makeServer({ rows: [] });
    const system = makeSystem(server);
    await edit(system, "one");
    await flush(system);
    for (const row of server.rows) row.published = true;
    server.publishElsewhere("elsewhere-later");
    system.stat.receiveStat(server.snapshot());

    await edit(system, "two");
    await flush(system);

    expect(server.writes).toEqual([
      { type: "head", headBaseSha: "sha" },
      { type: "patch", patchId: "elsewhere-later" },
    ]);
    system.dispose();
  });

  test("a stat taken before our save still leaves our save as the parent", async () => {
    // The ordinary race: a stat already in flight when our write landed. It
    // reports the head we wrote ON, and naming that would walk the parent back.
    const server = makeServer({ rows: incident() });
    const system = makeSystem(server);
    const before = server.snapshot();
    const first = await edit(system, "one");
    await flush(system);
    system.stat.receiveStat(before);

    await edit(system, "two");
    await flush(system);

    expect(server.writes).toEqual([
      { type: "patch", patchId: "elsewhere-published" },
      { type: "patch", patchId: first },
    ]);
    system.dispose();
  });

  test("a stat that caught up to some of our saves keeps the rest", async () => {
    // Two saves in a row, and a stat taken between them: it names the first as
    // the head. What is left was written on top of it, so a repeat of that same
    // stat must not throw the second away.
    const server = makeServer({ rows: [] });
    const system = makeSystem(server);
    const first = await edit(system, "one");
    await flush(system);
    const between = server.snapshot();
    const second = await edit(system, "two");
    await flush(system);
    system.stat.receiveStat(between);
    system.stat.receiveStat(between);

    expect(system.patchSync.currentParentRef()).toEqual({
      type: "patch",
      patchId: second,
    });
    expect(first).not.toBe(second);
    system.dispose();
  });
});

describe("a versioned head is never rewound by an older answer", () => {
  test("a stat that lands after a newer one is ignored", async () => {
    // Two answers in flight — the poll and a re-sync, say — landing in the
    // wrong order. The second to arrive is the older, and must not win.
    const server = makeServer({ rows: incident(), versions: true });
    const system = makeSystem(server);
    const older = server.snapshot();
    server.publishElsewhere("elsewhere-later");
    system.stat.receiveStat(server.snapshot());
    system.stat.receiveStat(older);

    await edit(system, "mine");
    await flush(system);

    expect(server.writes).toEqual([
      { type: "patch", patchId: "elsewhere-later" },
    ]);
    system.dispose();
  });

  test("an answer taken before our own save does not put the parent back", async () => {
    const server = makeServer({ rows: incident(), versions: true });
    const system = makeSystem(server);
    const before = server.snapshot();
    const first = await edit(system, "one");
    await flush(system);
    system.stat.receiveStat(before);

    await edit(system, "two");
    await flush(system);

    expect(server.writes).toEqual([
      { type: "patch", patchId: "elsewhere-published" },
      { type: "patch", patchId: first },
    ]);
    system.dispose();
  });

  test("a head that moves BACK, because it was discarded, is still believed", async () => {
    // Why a version and not seq_num: a discard of the head lowers it. A client
    // that only believed a higher head would name the deleted patch forever.
    const server = makeServer({
      rows: [
        { patchId: "theirs-first" as PatchId, published: false },
        { patchId: "theirs-last" as PatchId, published: false },
      ],
      versions: true,
    });
    const system = makeSystem(server);
    server.discard("theirs-last");
    system.stat.receiveStat(server.snapshot());

    await edit(system, "mine");
    await flush(system);

    expect(server.writes).toEqual([{ type: "patch", patchId: "theirs-first" }]);
    system.dispose();
  });

  test("a stat newer than our save wins, even when it does not list our patch", async () => {
    const server = makeServer({ rows: [], versions: true });
    const system = makeSystem(server);
    await edit(system, "one");
    await flush(system);
    for (const row of server.rows) row.published = true;
    server.publishElsewhere("elsewhere-later");
    system.stat.receiveStat(server.snapshot());

    await edit(system, "two");
    await flush(system);

    expect(server.writes).toEqual([
      { type: "head", headBaseSha: "sha" },
      { type: "patch", patchId: "elsewhere-later" },
    ]);
    system.dispose();
  });

  test("the list is not rewound either", async () => {
    const server = makeServer({ rows: incident(), versions: true });
    const system = makeSystem(server);
    const older = server.snapshot();
    server.writeElsewhere("theirs-newer");
    system.stat.receiveStat(server.snapshot());
    system.stat.receiveStat(older);

    expect(system.stat.currentPatchIds()).toEqual([
      "theirs-pending",
      "theirs-newer",
    ]);
    system.dispose();
  });
});

describe("a server that reports no head", () => {
  test("falls back to the last listed id, as before", async () => {
    const server = makeServer({
      rows: [{ patchId: "theirs-pending" as PatchId, published: false }],
      reportsHead: false,
    });
    const system = makeSystem(server);

    await edit(system, "mine");
    await flush(system);

    expect(server.writes).toEqual([
      { type: "patch", patchId: "theirs-pending" },
    ]);
    system.dispose();
  });
});

describe("a deleted head", () => {
  test("is not named again: the parent falls back until the next stat says what replaced it", async () => {
    const server = makeServer({
      rows: [
        { patchId: "theirs-pending" as PatchId, published: false },
        { patchId: "theirs-last" as PatchId, published: false },
      ],
    });
    const system = makeSystem(server);
    await new Promise((resolve) => setTimeout(resolve, 0));

    system.patchSync.forget(["theirs-last" as PatchId]);

    expect(system.patchSync.currentParentRef()).toEqual({
      type: "patch",
      patchId: "theirs-pending",
    });
    system.dispose();
  });
});
