import { initVal, type PatchId } from "@valbuild/core";
import { initTestSystem } from "./testSystem";

/**
 * Posting file bytes and attaching them to a patch.
 *
 * One rule produces all of the ordering below: **a file must exist for as long
 * as anything references it.**
 *
 * - Adding a file: upload, THEN record the patch, because the patch is what
 *   references the file.
 * - Removing a file: record the patch, THEN delete, because the patch is what
 *   stops referencing it.
 * - An upload that fails: no patch at all, so nothing references anything
 *   missing. Cleanup of what did land is best effort, and reported.
 *
 * The two PNGs are the smallest in the repo, the same pair `ValOpsFS.test.ts`
 * and the server-side upload tests use — 1x1 and 8x1.
 */
const smallPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQAAAAA3bvkkAAAACklEQVR4AWNgAAAAAgABc3UBGAAAAABJRU5ErkJggg==";
const anotherSmallPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAABAQAAAADLe9LuAAAACklEQVR4AWNgAAAAAgABc3UBGAAAAABJRU5ErkJggg==";

const HERO = "/public/val/hero.png";
const OTHER = "/public/val/other.png";

const imageModule = () => {
  const { c, s } = initVal();
  return c.define(
    "/img.val.ts",
    s.object({ hero: s.image(), other: s.image() }),
    {
      hero: {
        path: "/public/val/initial.png",
        width: 1,
        height: 1,
        mimeType: "image/png",
      },
      other: {
        path: "/public/val/initial.png",
        width: 1,
        height: 1,
        mimeType: "image/png",
      },
    },
  );
};

/** The `replace` + `file` pair every image edit is made of. */
const setImage = (field: string, filePath: string, data: string) => [
  {
    op: "replace" as const,
    path: [field],
    value: {
      _ref: filePath,
      _type: "file" as const,
      metadata: { width: 8, height: 1, mimeType: "image/png" },
    },
  },
  {
    op: "file" as const,
    path: [field],
    filePath,
    value: data,
    remote: false,
  },
];

describe("adding a file to a patch", () => {
  it("posts the bytes and records a patch carrying only their hash", async () => {
    const { sourceStore, patchStore, files, activity, dispose } =
      initTestSystem();

    await sourceStore.testReceive([imageModule()]);
    const record = await patchStore.createPatch(
      "/img.val.ts",
      setImage("hero", HERO, anotherSmallPng),
    );

    // The bytes reached the server, under this patch id.
    expect(files.get(record.patchId, HERO)).toEqual(anotherSmallPng);
    expect(activity.count("patch:upload-file", { subject: HERO })).toBe(1);

    // And the recorded patch does not contain them.
    const fileOp = record.patch.find((op) => op.op === "file");
    if (fileOp === undefined || fileOp.op !== "file") {
      throw new Error("expected the file op to survive");
    }
    expect(typeof fileOp.value).toBe("string");
    expect(fileOp.value).not.toContain("base64");
    expect(JSON.stringify(record.patch)).not.toContain("base64");
    dispose();
  });

  it("uploads before the patch exists, never after", async () => {
    const { sourceStore, patchStore, activity, ledger, dispose } =
      initTestSystem();

    await sourceStore.testReceive([imageModule()]);
    const before = activity.position();
    await patchStore.createPatch(
      "/img.val.ts",
      setImage("hero", HERO, smallPng),
    );

    // The upload is recorded before the patch is created. If it were the other
    // way round, a failed upload would leave source pointing at nothing.
    const uploadAt = activity.records.findIndex(
      (record, index) => index >= before && record.kind === "patch:upload-file",
    );
    const createAt = activity.records.findIndex(
      (record, index) => index >= before && record.kind === "patch:create",
    );
    expect(uploadAt).toBeGreaterThanOrEqual(0);
    expect(createAt).toBeGreaterThan(uploadAt);
    await ledger.has({ type: "source:patch-apply" });
    dispose();
  });

  it("uploads every file in a multi-file patch before recording it", async () => {
    const { sourceStore, patchStore, files, activity, dispose } =
      initTestSystem();

    await sourceStore.testReceive([imageModule()]);
    const record = await patchStore.createPatch("/img.val.ts", [
      ...setImage("hero", HERO, smallPng),
      ...setImage("other", OTHER, anotherSmallPng),
    ]);

    expect(files.get(record.patchId, HERO)).toEqual(smallPng);
    expect(files.get(record.patchId, OTHER)).toEqual(anotherSmallPng);
    expect(activity.count("patch:upload-file")).toBe(2);
    dispose();
  });
});

describe("an upload that fails", () => {
  it("creates no patch and does not move the head", async () => {
    const { sourceStore, patchStore, files, dispose } = initTestSystem();

    await sourceStore.testReceive([imageModule()]);
    const headBefore = await patchStore.getHead();
    files.failFor(HERO, "network down");

    const res = await patchStore.tryCreatePatch(
      "/img.val.ts",
      setImage("hero", HERO, smallPng),
    );

    expect(res).toMatchObject({
      status: "upload-failed",
      message: "network down",
    });
    // The guarantee: nothing references a file that is not there.
    expect(await patchStore.getHead()).toEqual(headBefore);
    expect(files.keys()).toEqual([]);
    dispose();
  });

  it("rolls back the files that did land", async () => {
    const { sourceStore, patchStore, files, activity, dispose } =
      initTestSystem();

    await sourceStore.testReceive([imageModule()]);
    // The first file uploads; the second fails. The first must not be left
    // behind as an orphan.
    files.failFor(OTHER, "quota exceeded");

    const res = await patchStore.tryCreatePatch("/img.val.ts", [
      ...setImage("hero", HERO, smallPng),
      ...setImage("other", OTHER, anotherSmallPng),
    ]);

    if (res.status !== "upload-failed") {
      throw new Error("expected the upload to fail");
    }
    expect(res.rolledBack).toEqual([HERO]);
    expect(res.orphaned).toEqual([]);
    expect(activity.count("patch:rollback-file", { subject: HERO })).toBe(1);
    expect(files.keys()).toEqual([]);
    dispose();
  });

  /**
   * Rollback is garbage collection, not correctness: an orphan is unreferenced,
   * so it is wasted bytes rather than a broken state. A rollback that fails must
   * therefore not turn a recoverable error into a worse one — it is reported so
   * the caller can still say "try again", and so something knows those bytes are
   * now garbage.
   */
  it("reports an orphan when the rollback itself fails, without masking the cause", async () => {
    const { sourceStore, patchStore, files, dispose } = initTestSystem();

    await sourceStore.testReceive([imageModule()]);
    files.failFor(OTHER, "quota exceeded");
    files.failDeletesFor(HERO);

    const res = await patchStore.tryCreatePatch("/img.val.ts", [
      ...setImage("hero", HERO, smallPng),
      ...setImage("other", OTHER, anotherSmallPng),
    ]);

    if (res.status !== "upload-failed") {
      throw new Error("expected the upload to fail");
    }
    // The original cause survives; the cleanup failure is reported beside it.
    expect(res.message).toBe("quota exceeded");
    expect(res.orphaned).toEqual([HERO]);
    expect(res.rolledBack).toEqual([]);
    // Still no patch. That is the part that has to hold even when cleanup does not.
    expect(await patchStore.getHead()).toMatchObject({ type: "empty" });
    dispose();
  });
});

describe("removing a file", () => {
  /**
   * The other direction of the same rule. Deleting first would leave the old
   * source pointing at bytes that are already gone — and permanently so, if the
   * patch then failed to record.
   */
  it("records the patch first, then deletes", async () => {
    const { sourceStore, patchStore, files, activity, dispose } =
      initTestSystem();

    await sourceStore.testReceive([imageModule()]);
    const added = await patchStore.createPatch(
      "/img.val.ts",
      setImage("hero", HERO, smallPng),
    );
    expect(files.get(added.patchId, HERO)).toEqual(smallPng);

    const before = activity.position();
    const removed = await patchStore.createPatch("/img.val.ts", [
      { op: "remove", path: ["hero"] },
      {
        op: "file",
        path: ["hero"],
        filePath: HERO,
        value: null,
        remote: false,
      },
    ]);

    const createAt = activity.records.findIndex(
      (record, index) => index >= before && record.kind === "patch:create",
    );
    const deleteAt = activity.records.findIndex(
      (record, index) => index >= before && record.kind === "patch:delete-file",
    );
    expect(createAt).toBeGreaterThanOrEqual(0);
    expect(deleteAt).toBeGreaterThan(createAt);
    expect(files.get(removed.patchId, HERO)).toBeUndefined();
    dispose();
  });

  it("does not upload anything for a delete", async () => {
    const { sourceStore, patchStore, activity, dispose } = initTestSystem();

    await sourceStore.testReceive([imageModule()]);
    const before = activity.position();
    await patchStore.createPatch("/img.val.ts", [
      {
        op: "file",
        path: ["hero"],
        filePath: HERO,
        value: null,
        remote: false,
      },
    ]);

    expect(activity.count("patch:upload-file", { since: before })).toBe(0);
    expect(activity.count("patch:delete-file", { since: before })).toBe(1);
    dispose();
  });
});

describe("a patch with no files", () => {
  it("touches the upload seam not at all", async () => {
    const { sourceStore, patchStore, activity, dispose } = initTestSystem();

    await sourceStore.testReceive([imageModule()]);
    await patchStore.createPatch("/img.val.ts", [
      // `add`, not `replace`: the fixture's metadata has no `alt`, and JSON
      // Patch `replace` requires the target to exist — so `replace` here was a
      // patch that could never apply, which is not what this test is about. The
      // product uses `add` for the same reason (see `ImageField`).
      { op: "add", path: ["hero", "metadata", "alt"], value: "an alt" },
    ]);

    expect(activity.count("patch:upload-file")).toBe(0);
    expect(activity.count("patch:delete-file")).toBe(0);
    dispose();
  });
});

/**
 * Which URL a just-uploaded file is reachable at, which is the difference
 * between a thumbnail and a broken image.
 *
 * `filePatchIds` is what a component turns into
 * `/api/val/files{path}?patch_id=...`, and the gate on it used to be
 * `pendingIds` — locally created and not yet acknowledged. The premise was that
 * a saved patch's file is fetchable at its committed path, and that is false:
 * SAVED means `PUT /patches` succeeded and the bytes are in the patch directory,
 * PUBLISHED means `/save` wrote them to the committed path. Every pending edit
 * sits between the two.
 *
 * So a gallery upload rendered for the second before its write came back and then
 * broke. Verified in a browser: the tile's `naturalWidth` was 0 and its `src` had
 * fallen through to `/val/images/...`, where no file exists until publish.
 */
describe("a file's URL between saving and publishing", () => {
  it("still points at the patch after the write is acknowledged", async () => {
    const { sourceStore, patchStore, patchSync, stat, dispose } =
      initTestSystem();
    await sourceStore.testReceive([imageModule()]);
    // A stat, so the write has a `baseSha` to name as its parent. Without one
    // the patch stays unsaved and the test would pass for the wrong reason.
    stat.simulateExternal([]);

    await patchStore.createPatch(
      "/img.val.ts",
      setImage("hero", HERO, smallPng),
    );
    await patchSync.flush();

    // Saved: the server has the patch. Not published: nothing has written the
    // bytes to `/public`, so the committed path still has no file behind it.
    expect(patchStore.isPending("local-1" as PatchId)).toBe(false);
    expect(patchStore.filePatchIds().get(HERO)).toBe("local-1");
    dispose();
  });

  it("stops pointing at the patch once it has shipped", async () => {
    const { sourceStore, patchStore, patchSync, stat, dispose } =
      initTestSystem();
    await sourceStore.testReceive([imageModule()]);
    stat.simulateExternal([]);
    await patchStore.createPatch(
      "/img.val.ts",
      setImage("hero", HERO, smallPng),
    );
    await patchSync.flush();

    // PUBLISHED, not dropped — and the difference is the whole point. A
    // published patch stays in the chain in `http` mode, so "is it in the chain"
    // is not the question; dropping it would make this test pass with the gate
    // removed entirely.
    patchStore.markPublished(["local-1" as PatchId]);

    expect(patchStore.filePatchIds().get(HERO)).toBeUndefined();
    dispose();
  });
});
