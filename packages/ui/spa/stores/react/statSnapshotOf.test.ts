import type { PatchId } from "@valbuild/core";
import { statSnapshotOf, type StatResponseJson } from "./statSnapshotOf";

/**
 * The re-sync after a conflict reads `/stat` outside the provider's poll, and
 * takes from it everything the poll's intake would. Each field dropped here
 * was a way for the store to adopt half an answer: a schema it never compares,
 * a chain version it never notes. (A removal nobody is
 * told about is the `fs` answer's, and has its own test in
 * `schemaFreshness.test.ts`.)
 */
test("the re-sync's snapshot carries what the intake would", () => {
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
  };

  expect(statSnapshotOf(json)).toMatchObject({
    baseSha: "base",
    sourcesSha: "sources",
    schemaSha: "schema",
    patches: ["p"],
    headVersion: 7,
  });
});
