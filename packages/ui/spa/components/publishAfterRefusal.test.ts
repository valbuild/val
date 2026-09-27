import { initVal, type ModuleFilePath, type PatchId } from "@valbuild/core";
import { createSystem, type System } from "../stores/createSystem";
import type { PublishOutcome } from "../stores/PublishSeam";
import { describePublishButton } from "./publishButtonState";

/**
 * "Make changes, publish, make some more — and Publish is a disabled 'Fix
 * errors'."
 *
 * The sequence as reported, in `http` mode, with the server refusing the
 * second attempt the way `/save` does when a patch does not apply (it answers
 * 400 with the patch blamed, and nothing is committed). Why it refused is not
 * what this is about — a deployment still on the build before the first
 * publish is one way — only that a refusal of ONE attempt must not decide the
 * next, and must not outlive the retry that publishes the change.
 *
 * The button's inputs are derived from the system as `PublishButton` derives
 * them.
 */
const project = () => {
  const { c, s } = initVal();
  return [
    c.define("/a.val.ts", s.object({ title: s.string(), body: s.string() }), {
      title: "original",
      body: "original",
    }),
  ];
};

function makeSystem(outcomes: PublishOutcome[]): System {
  const system = createSystem({
    fetchPatches: async () => ({ patches: [] }),
    createPatchId: (() => {
      let next = 0;
      return () => `p${++next}` as PatchId;
    })(),
    mode: "http",
    savePatches: async ({ patches, parentRef }) => ({
      status: "saved",
      newPatchIds: patches.map((patch) => patch.patchId),
      parentRef,
    }),
    publishPatches: async () => {
      const outcome = outcomes.shift();
      if (outcome === undefined) throw new Error("no outcome left");
      return outcome;
    },
  });
  system.host.receive(project());
  system.stat.receiveStat({ patches: [], baseSha: "sha", headCommitSha: "c0" });
  return system;
}

async function edit(system: System, field: string, value: string) {
  const res = await system.patchStore.createPatch(
    "/a.val.ts" as ModuleFilePath,
    [{ op: "replace", path: [field], value }],
  );
  if (res.status !== "created") throw new Error(`createPatch: ${res.status}`);
  await system.patchSync.flush();
}

/** What `PublishButton` hands `describePublishButton`, read off the system. */
function button(system: System) {
  const store = system.patchStore;
  const published = store.publishedPatchIds();
  const pendingServerSide = store
    .allRecords()
    .filter(
      (record) =>
        !store.isPending(record.patchId) &&
        !record.appliedAt &&
        !published.has(record.patchId),
    );
  return describePublishButton({
    mode: "http",
    publishRefusal: null,
    validationErrorCount: 0,
    conflictingChangeCount: Object.values(system.patchErrors()).reduce(
      (count, errors) => count + Object.keys(errors).length,
      0,
    ),
    isPublishing: false,
    publishDisabled: false,
    autoPublish: false,
    pendingServerSidePatchCount: pendingServerSide.length,
    pendingClientSidePatchCount: store.unsavedRecords().length,
    netChangesEmpty: false,
    heldChangeCount: 0,
  });
}

test("publish, edit, publish is refused: the next attempt can still be made, and a successful one clears the refusal", async () => {
  const system = makeSystem([
    { status: "published", commitSha: "c1" },
    {
      status: "patch-errors",
      message: "Failed to create commit",
      errors: { ["p2" as PatchId]: "Cannot apply patch: path not found" },
    },
    { status: "published", commitSha: "c2" },
  ]);

  await edit(system, "title", "first");
  expect((await system.publish([], "first")).status).toBe("published");

  await edit(system, "body", "second");
  expect((await system.publish([], "second")).status).toBe("failed");

  // What the editor saw: a disabled "Fix errors" and no way past it.
  expect(button(system)).toMatchObject({
    kind: "ready",
    label: "Publish",
    action: "publish",
  });

  // The retry goes through (the deployment caught up, say)...
  expect((await system.publish([], "second, again")).status).toBe("published");
  // ...and the change it shipped is no longer reported as one that failed.
  expect(system.patchErrors()).toEqual({});
  system.dispose();
});
