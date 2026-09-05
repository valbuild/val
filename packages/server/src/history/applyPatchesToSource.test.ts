import type { ModuleFilePath, PatchId } from "@valbuild/core";
import type { JSONValue, Patch } from "@valbuild/core/patch";
import { applyPatchesToSource, type ReplayInput } from "./applyPatchesToSource";

const path = "/content/page.val.ts" as ModuleFilePath;

function replay(
  patchId: string,
  patch: Patch,
  coreVersion = "1.0.0",
): ReplayInput {
  return { patchId: patchId as PatchId, coreVersion, patch };
}

describe("applyPatchesToSource", () => {
  test("replays patches in order", () => {
    const before: JSONValue = { title: "a", count: 1 };
    const res = applyPatchesToSource(path, before, [
      replay("p1", [{ op: "replace", path: ["title"], value: "b" }]),
      replay("p2", [{ op: "replace", path: ["count"], value: 2 }]),
    ]);
    expect(res.source).toEqual({ title: "b", count: 2 });
    expect(res.applied).toEqual(["p1", "p2"]);
    expect(res.failures).toEqual([]);
  });

  test("does not mutate the source it was given", () => {
    const before: JSONValue = { title: "a" };
    applyPatchesToSource(path, before, [
      replay("p1", [{ op: "replace", path: ["title"], value: "b" }]),
    ]);
    // The caller keeps `before` as the commit's "before" column - if replay
    // mutated it, the diff would compare a value against itself.
    expect(before).toEqual({ title: "a" });
  });

  // The whole reason this is per-patch: one bad op must not hide the good ones.
  test("keeps replaying after a patch that does not apply", () => {
    const before: JSONValue = { title: "a" };
    const res = applyPatchesToSource(path, before, [
      replay("p1", [{ op: "replace", path: ["title"], value: "b" }]),
      replay("p2", [{ op: "replace", path: ["nope", "deep"], value: "x" }]),
      replay("p3", [{ op: "add", path: ["extra"], value: "y" }]),
    ]);
    expect(res.source).toEqual({ title: "b", extra: "y" });
    expect(res.applied).toEqual(["p1", "p3"]);
    expect(res.failures).toHaveLength(1);
    expect(res.failures[0]).toMatchObject({
      kind: "patch-not-applicable",
      patchId: "p2",
    });
  });

  // A failed patch must leave the source untouched, or later patches replay
  // against something half-edited.
  test("a partially-applicable patch applies none of its ops", () => {
    const before: JSONValue = { title: "a" };
    const res = applyPatchesToSource(path, before, [
      replay("p1", [
        { op: "replace", path: ["title"], value: "b" },
        { op: "replace", path: ["missing", "deep"], value: "x" },
      ]),
    ]);
    expect(res.source).toEqual({ title: "a" });
    expect(res.applied).toEqual([]);
  });

  // File ops carry bytes, not source edits. The bytes are in git at the commit.
  test("skips file ops but still counts the patch as applied", () => {
    const before: JSONValue = { img: { path: "/public/val/a.png" } };
    const res = applyPatchesToSource(path, before, [
      replay("p1", [
        { op: "replace", path: ["img"], value: { path: "/public/val/b.png" } },
        {
          op: "file",
          path: ["img"],
          filePath: "/public/val/b.png",
          value: "data:image/png;base64,AAAA",
          remote: false,
        },
      ]),
    ]);
    expect(res.source).toEqual({ img: { path: "/public/val/b.png" } });
    expect(res.applied).toEqual(["p1"]);
    expect(res.failures).toEqual([]);
  });

  test("a patch of only file ops applies cleanly", () => {
    const before: JSONValue = { a: 1 };
    const res = applyPatchesToSource(path, before, [
      replay("p1", [
        {
          op: "file",
          path: ["img"],
          filePath: "/public/val/b.png",
          value: "data:image/png;base64,AAAA",
          remote: false,
        },
      ]),
    ]);
    expect(res.source).toEqual({ a: 1 });
    expect(res.applied).toEqual(["p1"]);
  });
});
