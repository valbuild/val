import { ValOpsHttp } from "./ValOpsHttp";
import type { PatchId } from "@valbuild/core";

/**
 * What survives the chunked branch of `fetchPatches`.
 *
 * `fetchPatches` splits a non-empty id list into chunks to keep the query
 * string short, and then rebuilt its answer from `patches` and `errors` alone —
 * silently dropping `commits`, which is a fact about the whole BRANCH and not
 * about a chunk.
 *
 * That was not cosmetic. `ValServer`'s publish-head guard reads
 * `newestCommitSha(patches.commits)` to refuse a publish decided against a
 * world somebody else has since changed. A publish always names patch ids, so
 * it always took this branch, so the guard always saw `undefined` and always
 * skipped. Two clients could publish against the same head with neither told,
 * which is the whole thing the guard exists to prevent.
 *
 * Nothing caught it: `publishHead.test.ts` stubs the publish outcome, so it
 * exercises the client's half and never the server's.
 */

const COMMITS = [
  {
    commitSha: "c2",
    clientCommitSha: "c2",
    parentCommitSha: "c1",
    commitMessage: "second",
    branch: "main",
    creator: "someone",
    createdAt: "2026-01-02T00:00:00.000Z",
  },
];

function opsAnsweringChain(patchIds: PatchId[]) {
  const originalFetch = global.fetch;
  const body = {
    // The field names the response uses, which are not the ones the parsed
    // result exposes: `patch` is nullable on the wire and `applied` becomes
    // `appliedAt`. Copied from `GetApplicablePatches`, not from the result type.
    patches: patchIds.map((patchId) => ({
      path: "/content/page.val.ts",
      patch: null,
      patchId,
      authorId: null,
      baseSha: "base",
      createdAt: "2026-01-01T00:00:00.000Z",
      applied: null,
    })),
    commits: COMMITS,
  };
  global.fetch = (async () => ({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch;
  const ops = new ValOpsHttp(
    "https://content.val.build",
    "acme/site",
    "commit-sha",
    "main",
    { apiKey: "key" },
    // Nothing on this path evaluates a module or reads a schema.
    { modules: [] } as never,
  );
  return {
    ops,
    restore: () => {
      global.fetch = originalFetch;
    },
  };
}

test("a FILTERED fetch still carries the branch's commits", async () => {
  // The shape every publish takes: a non-empty id list, so the chunked branch.
  const ids = ["11111111-1111-4111-8111-111111111111" as PatchId];
  const { ops, restore } = opsAnsweringChain(ids);
  try {
    const res = await ops.fetchPatches({
      patchIds: ids,
      excludePatchOps: true,
    });

    expect(res.patches.map((patch) => patch.patchId)).toEqual(ids);
    // The assertion the publish-head guard depends on. Without it the guard
    // reads `undefined` and lets every stale publish through.
    expect(res.commits).toEqual(COMMITS);
  } finally {
    restore();
  }
});

test("an UNFILTERED fetch carries them too, so the two paths agree", async () => {
  // The contrast that makes the bug legible: this path always worked, which is
  // why the guard looked correct when it was read rather than run.
  const { ops, restore } = opsAnsweringChain([]);
  try {
    const res = await ops.fetchPatches({ excludePatchOps: true });

    expect(res.commits).toEqual(COMMITS);
  } finally {
    restore();
  }
});
