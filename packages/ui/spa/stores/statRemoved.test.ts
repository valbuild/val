import type { PatchId } from "@valbuild/core";
import { createSystem } from "./createSystem";
import { statSnapshotOf, type StatResponseJson } from "./react/statSnapshotOf";

/**
 * In `fs` mode every `/stat` DRAINS the server's removed-patch notices: a
 * notice dropped by whatever read it is the only news that someone's
 * unpublished work is gone. These pin that every reader hands them on.
 */

function makeSystem() {
  return createSystem({
    fetchPatches: async () => ({ patches: [] }),
    createPatchId: () => "p" as PatchId,
  });
}

test("a /stat read outside the intake still says what the server removed", () => {
  /*
   * In `fs` mode every `/stat` drains the server's removed-patch notices, so
   * a read that keeps only part of its answer — the conflict re-sync —
   * must hand them on, or nobody is ever told.
   */
  const system = makeSystem();
  // The toast logs as well; that is the point, and not this test's noise.
  const errors = jest.spyOn(console, "error").mockImplementation(() => {});
  const removed: unknown[] = [];
  system.stat.events.on("patch:removed-by-server", (event) => {
    removed.push(...event.removed);
  });
  const json: StatResponseJson = {
    type: "request-again",
    baseSha: "sha",
    sourcesSha: "sources",
    schemaSha: "schema",
    patches: [],
    profileId: null,
    mode: "fs",
    config: {},
    removed: [{ patchId: "gone" as PatchId, reason: "unreadable" }],
  };
  system.stat.receiveStat(statSnapshotOf(json));
  expect(removed).toEqual([{ patchId: "gone", reason: "unreadable" }]);

  system.stat.noteRemovedByServer([
    { patchId: "also" as PatchId, reason: "x" },
  ]);
  expect(removed).toHaveLength(2);
  errors.mockRestore();
});

test("removed-patch notices are delivered once, even on a stat dropped as older", () => {
  const system = makeSystem();
  const errors = jest.spyOn(console, "error").mockImplementation(() => {});
  const removed: unknown[] = [];
  system.stat.events.on("patch:removed-by-server", (event) => {
    removed.push(...event.removed);
  });
  system.stat.receiveStat({ patches: [], baseSha: "sha", headVersion: 5 });
  // Older than what is held, so its chain is not adopted — but the server
  // drained the notice into it, and it is said nowhere else.
  system.stat.receiveStat({
    patches: [],
    baseSha: "sha",
    headVersion: 4,
    removed: [{ patchId: "gone" as PatchId, reason: "unreadable" }],
  });
  expect(removed).toEqual([{ patchId: "gone", reason: "unreadable" }]);

  system.stat.receiveStat({
    patches: [],
    baseSha: "sha",
    headVersion: 6,
    removed: [{ patchId: "later" as PatchId, reason: "unreadable" }],
  });
  expect(removed).toHaveLength(2);
  errors.mockRestore();
});
