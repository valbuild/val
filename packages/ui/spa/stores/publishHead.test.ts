import {
  initVal,
  type ModuleFilePath,
  type PatchId,
  type SourcePath,
} from "@valbuild/core";
import { createSystem } from "./createSystem";

/**
 * Refusing a publish decided against a world somebody else has changed.
 *
 * Git's own not-fast-forward guard does not cover this. `ValServer` fetches the
 * chain and commits FRESH at publish time, so the parent commit it sends is
 * always the server's current one — the commit always applies, and the person
 * who read the review screen never finds out that the set they approved is not
 * the set that shipped.
 *
 * So the client names the newest commit it knew about, and the server refuses
 * when it sees a newer one. Before the commit, so nothing is written and the
 * answer is "look again" rather than "your commit was rejected".
 */

const MODULE = "/a.val.ts" as ModuleFilePath;
const TITLE = '/a.val.ts?p="title"' as SourcePath;

const project = () => {
  const { c, s } = initVal();
  return [c.define(MODULE, s.object({ title: s.string() }), { title: "base" })];
};

function makeSystem(options?: { headMoved?: boolean; commitSha?: string }) {
  const sent: (string | undefined)[] = [];
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
      sent.push(request.expectedHeadCommitSha);
      return options?.headMoved
        ? { status: "head-moved", message: "someone else published" }
        : {
            status: "published",
            ...(options?.commitSha !== undefined
              ? { commitSha: options.commitSha }
              : {}),
          };
    },
  });
  system.host.receive(project());
  return { system, sent };
}

async function edit(system: ReturnType<typeof makeSystem>["system"]) {
  const res = await system.patchStore.createPatch(MODULE, [
    { op: "replace", path: ["title"], value: "mine" },
  ]);
  if (res.status !== "created") throw new Error(`createPatch: ${res.status}`);
  await system.patchSync.flush();
  return res.record.patchId;
}

test("a publish carries the head the client last saw", async () => {
  const { system, sent } = makeSystem();
  system.stat.receiveStat({
    patches: [],
    baseSha: "sha",
    headCommitSha: "commit-1",
  });
  await edit(system);

  expect((await system.publish([], "ship it")).status).toBe("published");

  expect(sent).toEqual(["commit-1"]);
});

test("a server that says the head moved refuses, and says which", async () => {
  const { system } = makeSystem({ headMoved: true });
  system.stat.receiveStat({
    patches: [],
    baseSha: "sha",
    headCommitSha: "commit-1",
  });
  await edit(system);

  const res = await system.publish([], "ship it");

  /*
   * Refused, not failed. Nothing was written, and the thing to do about it is
   * specific — look at the review screen again — which is why it is its own
   * reason rather than a message on a failure.
   */
  expect(res).toEqual({ status: "refused", reason: "head-moved" });
});

test("a client with no head publishes exactly as before", async () => {
  const { system, sent } = makeSystem();
  // `fs` mode, or a server that predates the field. The check cannot start
  // refusing publishes for something the client never sets.
  system.stat.receiveStat({ patches: [], baseSha: "sha" });
  await edit(system);

  expect((await system.publish([], "ship it")).status).toBe("published");

  expect(sent).toEqual([undefined]);
});

test("the head is the latest one stat said, not the first", async () => {
  const { system, sent } = makeSystem();
  system.stat.receiveStat({
    patches: [],
    baseSha: "sha",
    headCommitSha: "commit-1",
  });
  const mine = await edit(system);
  /*
   * Somebody publishes, this client is told, and it publishes afterwards. The
   * head it names has to be the one it now knows about.
   *
   * `mine` is listed: stat is authoritative about what the chain holds, so
   * leaving this tab's own patch out of it drops the patch and there is nothing
   * left to publish.
   */
  system.stat.receiveStat({
    patches: [mine],
    baseSha: "sha",
    headCommitSha: "commit-2",
  });

  await system.publish([], "ship it");

  expect(sent).toEqual(["commit-2"]);
  expect(system.sourceStore.peek(TITLE)).toMatchObject({ status: "ready" });
});

test("a publish moves the head, so the NEXT one is not refused as somebody else's", async () => {
  /*
   * The client refusing its own second publish.
   *
   * `headCommitSha` moved only on a `/stat` response, so between a publish and
   * the next poll this client still believed the pre-publish head. Its next
   * publish sent that as `expectedHeadCommitSha`, the server compared it with
   * the commit this same client had just made, and answered 409 "someone else
   * published while you were reviewing". With auto-publish, which publishes on
   * every pause in typing, that window is hit routinely — and the message
   * blames a colleague for the user's own commit.
   *
   * `/save` now answers with the sha it just wrote, and this is where it lands.
   * No `/stat` is delivered between the two publishes below, which is the
   * point: the second one must already know about the first.
   */
  const { system, sent } = makeSystem({ commitSha: "commit-2" });
  system.stat.receiveStat({
    patches: [],
    baseSha: "sha",
    headCommitSha: "commit-1",
  });

  await edit(system);
  expect((await system.publish([], "first")).status).toBe("published");
  expect(sent).toEqual(["commit-1"]);

  await edit(system);
  expect((await system.publish([], "second")).status).toBe("published");
  expect(sent).toEqual(["commit-1", "commit-2"]);
});

test("a server that answers no sha leaves the head where it was", async () => {
  // `fs` mode has no publish head, and neither does a server that predates
  // this. Neither may have the head cleared out from under it.
  const { system, sent } = makeSystem();
  system.stat.receiveStat({
    patches: [],
    baseSha: "sha",
    headCommitSha: "commit-1",
  });

  await edit(system);
  await system.publish([], "first");
  await edit(system);
  await system.publish([], "second");

  expect(sent).toEqual(["commit-1", "commit-1"]);
});

test("a stat answered before this publish does not put the client back on the old head", async () => {
  /*
   * The other half of the window above, and the one a poll makes routine.
   *
   * `/stat` is asked and answered; publishing in between changes the answer
   * after the question was asked. So the response carries the PRE-publish head
   * — truthfully, for the moment it was computed — and adopting it puts this
   * client back on a world it has already left. Its next publish then names a
   * commit the server has moved past and is refused 409 "someone else
   * published", about its own commit. `/save` moving the head fixed the gap
   * between two publishes; this is the same gap with a stat landing in it.
   */
  const { system, sent } = makeSystem({ commitSha: "commit-2" });
  system.stat.receiveStat({
    patches: [],
    baseSha: "sha",
    headCommitSha: "commit-1",
  });

  await edit(system);
  expect((await system.publish([], "first")).status).toBe("published");

  // In flight while the publish was happening: honest when it was computed,
  // stale by the time it arrives.
  system.stat.receiveStat({
    patches: [],
    baseSha: "sha",
    headCommitSha: "commit-1",
  });

  await edit(system);
  await system.publish([], "second");

  expect(sent).toEqual(["commit-1", "commit-2"]);
});

test("the SECOND stat saying so is believed, so a rewound head is not a wedge", async () => {
  /*
   * Why the stale head is ignored once rather than forever.
   *
   * A head that has really gone backwards — a force-push over a published
   * commit — is rare, but a client that refused to hear it would be stuck
   * naming a commit nobody else has, refused on every publish, until the page
   * was reloaded. The poll is serial, so exactly one answer can have been in
   * flight when the publish landed; anything after that is the server's
   * current word and is taken as such.
   */
  const { system, sent } = makeSystem({ commitSha: "commit-2" });
  system.stat.receiveStat({
    patches: [],
    baseSha: "sha",
    headCommitSha: "commit-1",
  });

  await edit(system);
  await system.publish([], "first");

  // The one that was in flight, then one asked afterwards that still says it.
  system.stat.receiveStat({
    patches: [],
    baseSha: "sha",
    headCommitSha: "commit-1",
  });
  system.stat.receiveStat({
    patches: [],
    baseSha: "sha",
    headCommitSha: "commit-1",
  });

  await edit(system);
  await system.publish([], "second");

  expect(sent).toEqual(["commit-1", "commit-1"]);
});

test("a stat that has caught up moves the head on as usual", async () => {
  // Somebody else published after this client did. Nothing about the guard may
  // stand between this client and a head it has not seen before.
  const { system, sent } = makeSystem({ commitSha: "commit-2" });
  system.stat.receiveStat({
    patches: [],
    baseSha: "sha",
    headCommitSha: "commit-1",
  });

  await edit(system);
  await system.publish([], "first");

  system.stat.receiveStat({
    patches: [],
    baseSha: "sha",
    headCommitSha: "commit-3",
  });

  await edit(system);
  await system.publish([], "second");

  expect(sent).toEqual(["commit-1", "commit-3"]);
});
