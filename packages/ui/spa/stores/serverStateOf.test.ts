import type { ModuleFilePath, PatchId } from "@valbuild/core";
import { createSystem } from "./createSystem";
import type { PatchRecord } from "./types";

/**
 * Where the server says one patch is, for a tab that was told to expect it.
 * A fresh tab's chain never lists a patch that has SHIPPED, so "not in my
 * chain" cannot tell "not saved yet" from "already published" -- the builder
 * tab waited out its deadline over a change another publish had taken.
 */

const record = (patchId: string, applied: boolean): PatchRecord => ({
  patchId: patchId as PatchId,
  moduleFilePath: "/a.val.ts" as ModuleFilePath,
  patch: [{ op: "replace", path: ["title"], value: "x" }],
  createdAt: "2026-01-01T00:00:00.000Z",
  authorId: "me",
  ...(applied ? { appliedAt: { commitSha: "c1" } } : {}),
});

function systemAnswering(
  answer: () => Promise<{
    patches: PatchRecord[];
    errors?: Record<string, string>;
  }>,
) {
  return createSystem({ fetchPatches: answer, mode: "http" });
}

test("a shipped patch is shipped, though no chain lists it", async () => {
  const system = systemAnswering(async () => ({
    patches: [record("p1", true)],
  }));
  await expect(system.patchStore.serverStateOf("p1" as PatchId)).resolves.toBe(
    "shipped",
  );
  expect(system.patchStore.allRecords()).toEqual([]);
  system.dispose();
});

test("a saved patch not yet published is pending", async () => {
  const system = systemAnswering(async () => ({
    patches: [record("p1", false)],
  }));
  await expect(system.patchStore.serverStateOf("p1" as PatchId)).resolves.toBe(
    "pending",
  );
  system.dispose();
});

test("a patch the server does not have is absent", async () => {
  const system = systemAnswering(async () => ({ patches: [] }));
  await expect(system.patchStore.serverStateOf("p1" as PatchId)).resolves.toBe(
    "absent",
  );
  system.dispose();
});

test("a server that could not be asked, or could not read it, says nothing", async () => {
  const failing = systemAnswering(async () => {
    throw new Error("offline");
  });
  await expect(failing.patchStore.serverStateOf("p1" as PatchId)).resolves.toBe(
    "unknown",
  );
  failing.dispose();
  const unreadable = systemAnswering(async () => ({
    patches: [],
    errors: { p1: "could not read" },
  }));
  await expect(
    unreadable.patchStore.serverStateOf("p1" as PatchId),
  ).resolves.toBe("unknown");
  unreadable.dispose();
});
