import {
  initVal,
  type ModuleFilePath,
  type PatchId,
  type SourcePath,
} from "@valbuild/core";
import { createSystem, type System } from "./createSystem";
import type { PatchRecord } from "./types";

/**
 * A scoped client OVER TIME: type, publish, type again, publish again.
 *
 * `patchGroupPublish.test.ts` covers one scoped publish from a standing start.
 * This covers what happens after that — the states a real editing session
 * spends almost all of its time in, and which a single-shot test never reaches:
 *
 * - an edit made WHILE scoped has to be visible to the person making it;
 * - a second publish has to be possible, and has to ship the second group;
 * - what ships must never leave behind an earlier patch from the same patch set.
 */

const MODULE = "/a.val.ts" as ModuleFilePath;
const OTHER = "/b.val.ts" as ModuleFilePath;
const TITLE = '/a.val.ts?p="title"' as SourcePath;
const OTHER_TITLE = '/b.val.ts?p="title"' as SourcePath;

const project = () => {
  const { c, s } = initVal();
  return [
    c.define(MODULE, s.object({ title: s.string() }), { title: "base A" }),
    c.define(OTHER, s.object({ title: s.string() }), { title: "base B" }),
  ];
};

/** A patch from somebody else, which the chain learns about through `/stat`. */
const FOREIGN: PatchRecord = {
  patchId: "theirs" as PatchId,
  moduleFilePath: OTHER,
  patch: [{ op: "replace", path: ["title"], value: "theirs" }],
  createdAt: "2026-01-01T00:00:00.000Z",
  authorId: "someone-else",
  appliedAt: null,
};

function makeSystem(options?: { foreign?: PatchRecord[] }) {
  const publishes: PatchId[][] = [];
  const system = createSystem({
    fetchPatches: async (patchIds) => ({
      patches: (options?.foreign ?? []).filter((record) =>
        patchIds.includes(record.patchId),
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
    publishPatches: async (request) => {
      publishes.push([...request.patchIds]);
      return { status: "published" };
    },
  });
  system.host.receive(project());
  system.stat.receiveStat({ patches: [], baseSha: "sha" });
  return { system, publishes };
}

async function edit(
  system: System,
  moduleFilePath: ModuleFilePath,
  value: string,
): Promise<PatchId> {
  const res = await system.patchStore.createPatch(moduleFilePath, [
    { op: "replace", path: ["title"], value },
  ]);
  if (res.status !== "created") {
    throw new Error(`createPatch failed: ${res.status}`);
  }
  return res.record.patchId;
}

function read(system: System, path: SourcePath): unknown {
  const peek = system.sourceStore.peek(path);
  return peek.status === "ready" ? peek.data : peek.status;
}

test("an edit made while scoped is visible to the person making it", async () => {
  const { system } = makeSystem();
  const mine = await edit(system, MODULE, "mine");
  system.setPatchGroup([mine]);
  expect(read(system, TITLE)).toBe("mine");

  // The next keystroke. Nothing has re-scoped, because nothing in the UI does:
  // the scope was last set by the review screen or by seeding.
  await edit(system, MODULE, "mine, again");

  // The author must see their own typing. A scope that does not grow as its
  // owner writes turns the editor into a read-only view of its own past.
  expect(read(system, TITLE)).toBe("mine, again");
});

test("a second publish ships the second group", async () => {
  const { system, publishes } = makeSystem();
  const first = await edit(system, MODULE, "first");
  system.setPatchGroup([first]);

  const one = await system.publish([], "first");
  expect(one.status).toBe("published");
  expect(publishes[0]).toEqual([first]);

  // A publish CLOSES the group. Everything after this belongs to the next one.
  const second = await edit(system, MODULE, "second");

  const two = await system.publish([], "second");
  expect(two.status).toBe("published");
  expect(publishes[1]).toEqual([second]);
});

test("a scoped publish never leaves an earlier patch of the same set behind", async () => {
  const { system, publishes } = makeSystem();
  // Two edits to the SAME path: one patch set, and the second cannot ship
  // without the first or it applies onto a value that was never there.
  const earlier = await edit(system, MODULE, "earlier");
  const later = await edit(system, MODULE, "later");
  // Somebody else's work in another module — a different patch set, so it is
  // free to stay behind.
  const theirs = await edit(system, OTHER, "theirs");

  system.setPatchGroup([earlier, later]);
  await system.publish([], "ship the pair");

  expect(publishes[0]).toEqual([earlier, later]);
  expect(publishes[0]).not.toContain(theirs);
});

test("a group that skips an earlier patch of its own set is refused", async () => {
  const { system, publishes } = makeSystem();
  // Same module, same path: one patch set. `later` was written against the
  // value `earlier` produced, so shipping it alone applies it onto a value that
  // has never existed anywhere.
  await edit(system, MODULE, "earlier");
  const later = await edit(system, MODULE, "later");

  /*
   * A group that violates the prefix invariant. `stageClosure` cannot produce
   * one — that is what it is for — but a group can arrive this way regardless:
   * a stale annotation, a repair that has not run, a client on an older
   * closure version, or a hand-written request to `/patch-groups`.
   */
  system.setPatchGroup([later]);

  const res = await system.publish([], "just the later one");

  expect(publishes).toEqual([]);
  expect(res.status).toBe("failed");
});

test("seeding from the server does not hide what this tab just wrote", async () => {
  const { system } = makeSystem();
  /*
   * The order a real session produces: the user types, and only then does the
   * shell first have a group annotation to scope to. That annotation was
   * fetched before the keystroke — the chain gains group information when it
   * gains ids this client does not have, and a patch this client wrote is never
   * one of those — so it names nothing.
   */
  await edit(system, MODULE, "just typed");
  expect(read(system, TITLE)).toBe("just typed");

  system.seedPatchGroup([]);

  // Scoping to the stale answer verbatim showed the value from BEFORE the
  // keystroke, having just accepted the keystroke.
  expect(read(system, TITLE)).toBe("just typed");
});

test("seeding still holds another author's patch", async () => {
  const { system } = makeSystem({ foreign: [FOREIGN] });
  const mine = await edit(system, MODULE, "mine");
  // Not this tab's: announced by `/stat` and fetched, like any foreign patch.
  system.stat.receiveStat({
    patches: [mine, FOREIGN.patchId],
    baseSha: "sha",
  });
  await system.patchSync.flush();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(read(system, OTHER_TITLE)).toBe("theirs");

  system.seedPatchGroup([mine]);

  // The union is with THIS TAB's writes, not with everything pending. A seed
  // that adopted the whole chain would make the scope meaningless.
  expect(read(system, TITLE)).toBe("mine");
  expect(read(system, OTHER_TITLE)).toBe("base B");
});
