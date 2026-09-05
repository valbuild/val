import { initVal } from "@valbuild/core";
import { initTestSystem, mfp } from "./testSystem";

/**
 * Duplicating a record entry, which the Studio does with a single `copy` op.
 *
 * `useDuplicateRecordEntry` writes that one op and nothing else - no read of
 * the source, no rebuilt value - so what has to hold is that `copy` really
 * lands the whole entry at the new key, through the same apply path every
 * other patch takes. If it did not, a duplicated page would come out empty and
 * the feature would look like it worked (the key appears in the site map)
 * until someone opened the copy.
 */
const blogs = () => {
  const { c, s } = initVal();
  return c.define(
    "/blogs.val.ts",
    s.record(
      s.object({
        title: s.string(),
        image: s.image(),
        tags: s.array(s.string()),
      }),
    ),
    {
      "/blogs/why-val": {
        title: "Why Val",
        image: {
          path: "/public/val/hero_a1b2c.png",
          width: 1200,
          height: 630,
          mimeType: "image/png",
        },
        tags: ["launch", "product"],
      },
    },
  );
};

/** The value at `path` in the store's patched source. */
async function read(
  sourceStore: ReturnType<typeof initTestSystem>["sourceStore"],
  path: string,
) {
  const res = await sourceStore.get(path, null);
  if (res.status !== "resolved-head") {
    throw new Error(`expected ${path} to resolve, got ${res.status}`);
  }
  return res.data;
}

describe("duplicating a record entry with a copy op", () => {
  it("lands the whole entry, nested values and all, at the new key", async () => {
    const { sourceStore, patchStore, dispose } = initTestSystem();
    await sourceStore.testReceive([blogs()]);

    await patchStore.createPatch(mfp("/blogs.val.ts"), [
      {
        op: "copy",
        from: ["/blogs/why-val"],
        path: ["/blogs/why-val-copy"],
      },
    ]);

    const copy = await read(
      sourceStore,
      '/blogs.val.ts?p="/blogs/why-val-copy"',
    );
    expect(copy).toEqual({
      title: "Why Val",
      image: {
        path: "/public/val/hero_a1b2c.png",
        width: 1200,
        height: 630,
        mimeType: "image/png",
      },
      tags: ["launch", "product"],
    });
    dispose();
  });

  it("leaves the original where it was", async () => {
    const { sourceStore, patchStore, dispose } = initTestSystem();
    await sourceStore.testReceive([blogs()]);

    await patchStore.createPatch(mfp("/blogs.val.ts"), [
      {
        op: "copy",
        from: ["/blogs/why-val"],
        path: ["/blogs/why-val-copy"],
      },
    ]);

    const original = await read(
      sourceStore,
      '/blogs.val.ts?p="/blogs/why-val"."title"',
    );
    expect(original).toBe("Why Val");
    dispose();
  });

  /**
   * The reason a duplicate does not re-upload anything: the copy points at the
   * same file. Editing one side's own fields must not reach the other, though —
   * `JSONOps.copy` deep-clones, and this is the check that it does.
   */
  it("gives the copy its own values to edit", async () => {
    const { sourceStore, patchStore, dispose } = initTestSystem();
    await sourceStore.testReceive([blogs()]);

    await patchStore.createPatch(mfp("/blogs.val.ts"), [
      { op: "copy", from: ["/blogs/why-val"], path: ["/blogs/why-val-copy"] },
    ]);
    await patchStore.createPatch(mfp("/blogs.val.ts"), [
      {
        op: "replace",
        path: ["/blogs/why-val-copy", "title"],
        value: "Why Val, again",
      },
    ]);

    const copy = await read(
      sourceStore,
      '/blogs.val.ts?p="/blogs/why-val-copy"."title"',
    );
    const original = await read(
      sourceStore,
      '/blogs.val.ts?p="/blogs/why-val"."title"',
    );
    expect(copy).toBe("Why Val, again");
    expect(original).toBe("Why Val");
    dispose();
  });
});
