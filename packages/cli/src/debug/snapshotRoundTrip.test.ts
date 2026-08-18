import fs from "fs";
import path from "path";
import os from "os";
import {
  compareWithCapturedReport,
  readCapturedReport,
  replaySnapshot,
} from "@valbuild/server";
import { createDebugContext } from "./context";
import { buildSnapshot } from "./snapshot";

const FIXTURE = path.resolve(__dirname, "..", "__fixtures__/debug-snapshot");

/**
 * The whole point of a snapshot: capture it in one project, then reproduce the
 * same failure somewhere else with no network and no access to the original repo.
 *
 * If this passes, `val debug` -> unzip into debug/ -> `pnpm debug:replay` works.
 */
describe("debug snapshot round trip", () => {
  let snapshotDir: string;

  beforeAll(async () => {
    const ctx = await createDebugContext({ root: FIXTURE });
    const snapshot = await buildSnapshot(ctx);

    // The OS temp dir, not the repo's .tmp: ValOpsFS.test.ts rmSync's .tmp
    // wholesale on startup, and jest runs test files in parallel workers.
    snapshotDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "snapshot-round-trip-"),
    );
    // Same thing the zip does, minus the zipping.
    for (const [entryPath, contents] of Object.entries(snapshot.entries)) {
      const absPath = path.join(snapshotDir, entryPath);
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, contents);
    }
  });

  test("the snapshot is a loadable Val project on its own", async () => {
    const result = await replaySnapshot(snapshotDir);

    // Loading at all means the generated val.modules.ts, val.config, tsconfig
    // and the imported schema fragment all made it in.
    expect(result.patches).toHaveLength(3);
    expect(result.patches.map((patch) => patch.moduleFilePath)).toEqual([
      "/content/projects.val.ts",
      "/content/projects.val.ts",
      "/content/projects.val.ts",
    ]);
  });

  test("the replay reproduces the same failure, attributed to the same patch", async () => {
    const result = await replaySnapshot(snapshotDir);

    expect(Object.entries(result.unappliablePatches)).toEqual([
      [
        "33333333-3333-4333-8333-333333333333",
        {
          moduleFilePath: "/content/projects.val.ts",
          message: "Array index out of bounds",
        },
      ],
    ]);
    const failing = result.patches.find((patch) => patch.error);
    expect(failing?.authorId).toBe("author-a");
    expect(failing?.createdAt).toBe("2026-08-11T09:00:05.000Z");
  });

  test("the replay agrees with the report captured at snapshot time", async () => {
    const result = await replaySnapshot(snapshotDir);
    const captured = readCapturedReport(snapshotDir);
    if (!captured) {
      throw new Error("Snapshot has no report.json");
    }

    const comparison = compareWithCapturedReport(result, captured);

    expect(comparison).toEqual({
      stillFailing: ["33333333-3333-4333-8333-333333333333"],
      nowApplying: [],
      newlyFailing: [],
      reproduced: true,
    });
  });

  test("the appliable patches are applied, so the diff is inspectable", async () => {
    const result = await replaySnapshot(snapshotDir);

    const patched = result.patchedSourceFiles["/content/projects.val.ts"];
    expect(patched).toContain("BBL Housing");
    // The removal applied; the edit to the removed index did not.
    expect(patched).not.toContain("Development");
  });
});
