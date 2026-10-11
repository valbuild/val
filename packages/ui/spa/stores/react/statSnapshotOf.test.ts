import type { PatchId } from "@valbuild/core";
import { statSnapshotOf, type StatResponseJson } from "./statSnapshotOf";

/**
 * The re-sync after a conflict reads `/stat` outside the provider's poll, and
 * takes from it everything the poll's intake would. Each field dropped here
 * was a way for the store to adopt half an answer: a new chain version beside
 * groups read at an old one, a schema it never compares. (A removal nobody is
 * told about is the `fs` answer's, and has its own test in
 * `schemaFreshness.test.ts`.)
 */
test("the re-sync's snapshot carries what the intake would", () => {
  const groups = [
    {
      patchGroupId: "g",
      authorId: "me",
      createdAt: "2026-01-01T00:00:00.000Z",
      publishedAt: null,
      patchIds: ["p" as PatchId],
    },
  ];
  const json: StatResponseJson = {
    type: "use-websocket",
    url: "wss://example",
    nonce: "n",
    baseSha: "base",
    sourcesSha: "sources",
    schemaSha: "schema",
    commits: [],
    deployments: [],
    patches: ["p" as PatchId],
    appliedPatches: [],
    profileId: "me",
    mode: "http",
    config: {},
    headVersion: 7,
    patchGroups: groups,
  };

  expect(statSnapshotOf(json)).toMatchObject({
    baseSha: "base",
    sourcesSha: "sources",
    schemaSha: "schema",
    patches: ["p"],
    headVersion: 7,
    patchGroups: groups,
    profileId: "me",
  });
});
