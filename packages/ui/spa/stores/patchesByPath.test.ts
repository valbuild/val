import { initVal, type ModuleFilePath } from "@valbuild/core";
import { createSystem } from "./createSystem";
import { mfp } from "./testSystem";

/**
 * The chain, indexed by the path a reader asks about.
 *
 * `FieldPatchAuthorsSection` is mounted on every non-compact field and used to
 * walk the whole chain itself, per field, woken by `patch:chain` — which moves
 * on every keystroke's patch and on every save. That is O(fields on screen x
 * chain length) per movement, and it re-rendered every one of those fields
 * whether or not its own answer had changed.
 *
 * Two claims, and the second is the one that stops the re-renders: the index is
 * built once per chain version, and a path whose answer has not moved gets the
 * SAME array back so `useSyncExternalStore` can bail out.
 */
const module = () => {
  const { c, s } = initVal();
  return c.define(
    "/t.val.ts",
    s.object({ title: s.string(), body: s.string() }),
    { title: "a", body: "b" },
  );
};

function build() {
  const system = createSystem({ fetchPatches: async () => ({ patches: [] }) });
  system.host.receive([module()]);
  return system;
}

const TITLE = '/t.val.ts?p="title"';
const BODY = '/t.val.ts?p="body"';

describe("PatchStore.patchesByPath", () => {
  it("indexes a patch under its op path and under its module", async () => {
    const system = build();
    await system.patchStore.createPatch(mfp("/t.val.ts"), [
      { op: "replace", path: ["title"], value: "typed" },
    ]);

    const byPath = system.patchStore.patchesByPath();

    expect(byPath.get(TITLE)?.length).toBe(1);
    // A module-level reader sees every patch in the module.
    expect(byPath.get("/t.val.ts")?.length).toBe(1);
    // And a sibling path sees nothing — which is the whole point.
    expect(byPath.get(BODY)).toBeUndefined();
    system.dispose();
  });

  it("hands back the SAME array for a path a later patch did not touch", async () => {
    const system = build();
    await system.patchStore.createPatch(mfp("/t.val.ts"), [
      { op: "replace", path: ["title"], value: "typed" },
    ]);
    const before = system.patchStore.patchesByPath().get(TITLE);

    // A patch on a sibling path. The chain moved, so the index is rebuilt —
    // but this path's answer did not, so its identity must not move either.
    await system.patchStore.createPatch(mfp("/t.val.ts"), [
      { op: "replace", path: ["body"], value: "also typed" },
    ]);

    expect(system.patchStore.patchesByPath().get(TITLE)).toBe(before);
    expect(system.patchStore.patchesByPath().get(BODY)?.length).toBe(1);
    system.dispose();
  });

  it("moves the identity when the path's own answer moves", async () => {
    const system = build();
    await system.patchStore.createPatch(mfp("/t.val.ts"), [
      { op: "replace", path: ["title"], value: "typed" },
    ]);
    const before = system.patchStore.patchesByPath().get(TITLE);

    await system.patchStore.createPatch(mfp("/t.val.ts"), [
      { op: "replace", path: ["title"], value: "typed again" },
    ]);

    expect(system.patchStore.patchesByPath().get(TITLE)).not.toBe(before);
    expect(system.patchStore.patchesByPath().get(TITLE)?.length).toBe(2);
    system.dispose();
  });

  /**
   * `isPending` moves WITHOUT the chain's membership moving, so it has to be
   * part of the comparison. A reader that showed "unsaved" would otherwise keep
   * showing it after the save landed.
   */
  it("moves the identity when a patch stops being pending", async () => {
    const system = build();
    const created = await system.patchStore.createPatch(mfp("/t.val.ts"), [
      { op: "replace", path: ["title"], value: "typed" },
    ]);
    if (created.status !== "created") {
      throw new Error(
        `expected the patch to be created, got ${created.status}`,
      );
    }
    const before = system.patchStore.patchesByPath().get(TITLE);
    expect(before?.[0].isPending).toBe(true);

    system.patchStore.markSaved([created.record.patchId]);

    const after = system.patchStore.patchesByPath().get(TITLE);
    expect(after).not.toBe(before);
    expect(after?.[0].isPending).toBe(false);
    system.dispose();
  });

  it("lists a record once however many of its ops land on one path", async () => {
    const system = build();
    await system.patchStore.createPatch(mfp("/t.val.ts"), [
      { op: "replace", path: ["title"], value: "one" },
      { op: "replace", path: ["title"], value: "two" },
    ]);

    expect(system.patchStore.patchesByPath().get(TITLE)?.length).toBe(1);
    system.dispose();
  });

  it("is the same map on a second read with nothing in between", async () => {
    const system = build();
    await system.patchStore.createPatch(mfp("/t.val.ts"), [
      { op: "replace", path: ["title"], value: "typed" },
    ]);

    // The memo on the chain version: N fields reading in one commit cost ONE
    // build, which is the other half of what this replaces.
    expect(system.patchStore.patchesByPath()).toBe(
      system.patchStore.patchesByPath(),
    );
    system.dispose();
  });

  it("is empty for a module nothing has touched", () => {
    const system = build();
    expect(
      system.patchStore.patchesByPath().get("/other.val.ts" as ModuleFilePath),
    ).toBeUndefined();
    system.dispose();
  });
});
