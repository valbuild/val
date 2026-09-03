import {
  initVal,
  type ModuleFilePath,
  type PatchId,
  type SourcePath,
} from "@valbuild/core";
import { createSystem, type System } from "./createSystem";

/**
 * Independent publish, at the seam where it either works or does not.
 *
 * The claim this file exists to hold up: **a client publishes its own patch
 * group and nothing else, even while other people's pending patches sit in the
 * same chain — and it renders the same set it would publish.**
 *
 * Both halves are asserted against the real `createSystem` graph with a fake
 * `POST /save`, so what is checked is the ids that reach the server and the
 * values that reach a reader. No UI, no provider, no staging component: if
 * these pass, the core is doing the thing regardless of what the review screen
 * looks like.
 *
 * Why the two halves have to be one file: publishing a set the editor was never
 * shown is the specific failure the whole feature exists to prevent. Testing
 * "publish ships the group" and "source renders the group" separately would let
 * them drift apart and both stay green.
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

function makeSystem() {
  const publishes: PatchId[][] = [];
  const system = createSystem({
    fetchPatches: async () => ({ patches: [] }),
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

/** What a reader actually sees at a path, which is the only thing that matters. */
function read(system: System, path: SourcePath): unknown {
  const peek = system.sourceStore.peek(path);
  return peek.status === "ready" ? peek.data : peek.status;
}

test("publishes only the group's patches, though the chain holds more", async () => {
  const { system, publishes } = makeSystem();

  // Three pending patches from a mixture of authors. Only the middle one is
  // this client's — the shape that used to be impossible to publish alone.
  const someoneElsesEarlier = await edit(system, OTHER, "theirs, earlier");
  const mine = await edit(system, MODULE, "mine");
  const someoneElsesLater = await edit(system, OTHER, "theirs, later");

  system.setPatchGroup([mine]);

  const result = await system.publish([], "ship mine");

  expect(result.status).toBe("published");
  expect(publishes).toEqual([[mine]]);
  // Stated separately and deliberately: the assertion above would still pass if
  // the other two had never been created, which is not what is being claimed.
  expect(publishes[0]).not.toContain(someoneElsesEarlier);
  expect(publishes[0]).not.toContain(someoneElsesLater);
  // And they are still pending — publishing mine did not discard theirs.
  expect(system.patchStore.allRecords().map((r) => r.patchId)).toEqual(
    expect.arrayContaining([someoneElsesEarlier, someoneElsesLater]),
  );
});

test("publishes the group in CHAIN order, not the order the group names", async () => {
  const { system, publishes } = makeSystem();

  const first = await edit(system, MODULE, "first");
  const second = await edit(system, MODULE, "second");

  // Named backwards on purpose. The server applies what it is given in the
  // order it is given, so a group — which is a set — must not be able to
  // reorder the chain by the order somebody happened to list it in.
  system.setPatchGroup([second, first]);
  await system.publish([]);

  expect(publishes).toEqual([[first, second]]);
});

test("an unscoped client still publishes the whole chain", async () => {
  const { system, publishes } = makeSystem();

  const one = await edit(system, MODULE, "one");
  const two = await edit(system, OTHER, "two");

  // `null` is fs mode and any content API without patch groups. The old
  // behaviour has to survive exactly, or turning groups on becomes the only
  // supported configuration.
  system.setPatchGroup(null);
  await system.publish([]);

  expect(publishes).toEqual([[one, two]]);
});

test("an empty group publishes nothing rather than everything", async () => {
  const { system, publishes } = makeSystem();

  await edit(system, MODULE, "pending");

  // The dangerous confusion in one test: if `[]` were ever treated as "no
  // scope", unstaging your last change would publish the entire project.
  system.setPatchGroup([]);
  const result = await system.publish([]);

  expect(result.status).toBe("nothing-to-publish");
  expect(publishes).toEqual([]);
});

test("renders base + the group, so what is shown is what would ship", async () => {
  const { system } = makeSystem();

  const mine = await edit(system, MODULE, "mine");
  await edit(system, OTHER, "theirs");

  // Before scoping, this client sees everything pending — today's behaviour.
  expect(read(system, TITLE)).toBe("mine");
  expect(read(system, OTHER_TITLE)).toBe("theirs");

  system.setPatchGroup([mine]);

  // After scoping, the other author's pending edit is not in this client's
  // view: `/b` is back at base while `/a` keeps the patch this group holds.
  expect(read(system, TITLE)).toBe("mine");
  expect(read(system, OTHER_TITLE)).toBe("base B");
});

test("a held patch is hidden, not discarded — re-staging brings it back", async () => {
  const { system } = makeSystem();

  const mine = await edit(system, MODULE, "mine");
  const theirs = await edit(system, OTHER, "theirs");

  system.setPatchGroup([mine]);
  expect(read(system, OTHER_TITLE)).toBe("base B");
  // Still in the chain. Hiding a patch must not be a one-way trapdoor: the
  // patch is held, not gone, and nothing has to be re-fetched to restore it.
  expect(system.patchStore.allRecords().map((r) => r.patchId)).toContain(
    theirs,
  );

  system.setPatchGroup([mine, theirs]);
  expect(read(system, OTHER_TITLE)).toBe("theirs");
});

test("a patch held before it ever applies still settles the chain", async () => {
  /*
   * The failure this pins is severe and completely invisible from the value.
   *
   * `chainSettled()` waits for every patch in the chain to be accounted for as
   * applied, failed or pending, and the editor holds EVERY field inert until it
   * is true (`useInitialPatchesApplied`). A held patch is none of those three,
   * so a source store that simply skips it leaves the chain unsettled and the
   * whole Studio dimmed for the life of the tab — while rendering exactly the
   * right content, which is what makes it so hard to spot.
   *
   * The ORDER here is the whole test. Applying a patch and then holding it
   * leaves a stale `appliedIds` entry that keeps the chain looking settled, so
   * that version passes with the bug present — it did, and it was worthless.
   * The real path is a foreign patch that is held from the moment it arrives
   * and therefore never applies at all: the Studio opens with a group set, and
   * somebody else's pending work comes down from the server.
   */
  const theirs = "p-theirs" as PatchId;
  const system = createSystem({
    fetchPatches: async () => ({
      patches: [
        {
          patchId: theirs,
          moduleFilePath: OTHER,
          patch: [{ op: "replace", path: ["title"], value: "theirs" }],
          createdAt: new Date().toISOString(),
          authorId: "someone-else",
        },
      ] as never,
    }),
    createPatchId: () => "p-mine" as PatchId,
    savePatches: async ({ patches, parentRef }) => ({
      status: "saved",
      newPatchIds: patches.map((patch) => patch.patchId),
      parentRef,
    }),
    publishPatches: async () => ({ status: "published" }),
  });
  system.host.receive(project());
  // Scoped BEFORE anything arrives, which is what a real session does.
  system.setPatchGroup([]);
  system.stat.receiveStat({ patches: [theirs], baseSha: "sha" });

  await new Promise((resolve) => setTimeout(resolve, 20));

  // Held, so not in the view...
  expect(read(system, OTHER_TITLE)).toBe("base B");
  // ...and yet the chain is finished with it.
  expect(system.patchStore.chainSettled()).toBe(true);
});

test("later patches in a module survive an earlier one being held", async () => {
  const { system } = makeSystem();

  // Two edits to the SAME module, so holding the first means the second has to
  // be replayed onto base rather than onto the first one's result. An
  // un-apply would get this wrong; a rebuild gets it right.
  const first = await edit(system, MODULE, "first");
  const second = await system.patchStore.createPatch(MODULE, [
    { op: "replace", path: ["title"], value: "second" },
  ]);
  if (second.status !== "created") throw new Error("createPatch failed");

  system.setPatchGroup([second.record.patchId]);

  expect(read(system, TITLE)).toBe("second");
  expect(system.patchGroup()).toEqual([second.record.patchId]);
  // The held one is untouched in the chain.
  expect(system.patchStore.allRecords().map((r) => r.patchId)).toContain(first);
});
