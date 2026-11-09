import { initVal } from "@valbuild/core";
import { initTestSystem, mfp } from "./testSystem";

/**
 * What the progress hooks read on every render (`allEntriesProgress`,
 * `entriesStatus`): counted once per view of a module, never per read.
 *
 * Counted per read, a page that merely POINTED at a `.jsonValues()` record of
 * 10,000 posts walked all of them a few times per keystroke -- one progress
 * hook per reference guard and one for search, re-rendered by every edit
 * anywhere -- and typing there froze for most of a second per character
 * (phase 10 of `docs/plans/one-content-model.md`).
 */
const project = (entries: number) => {
  const { c, s } = initVal();
  const posts = c.define(
    "/posts.val.ts",
    s.record(s.object({ title: s.string() })).jsonValues(),
    Object.fromEntries(
      Array.from({ length: entries }, (_, i) => [
        `/post-${i}`,
        c.json(() => Promise.resolve({ default: { title: `Post ${i}` } })),
      ]),
    ),
  );
  const page = c.define("/page.val.ts", s.object({ title: s.string() }), {
    title: "Featured",
  });
  return [posts, page];
};

describe("counting a module's `.jsonValues()` entries", () => {
  it("counts each module once, however often it is asked", async () => {
    const { sourceStore, activity, dispose } = initTestSystem();
    await sourceStore.testReceive(project(1_000));

    const before = activity.position();
    const first = sourceStore.allEntriesProgress();
    for (let i = 0; i < 10; i++) sourceStore.allEntriesProgress();

    expect(first).toEqual({ total: 1_000, loaded: 0, failed: 0 });
    // Twice per module: its markers, and its total.
    expect(
      activity.count("source:count-entries", {
        since: before,
        subject: "/posts.val.ts",
      }),
    ).toBe(2);
    dispose();
  });

  it("does not count a record again for a keystroke in another module", async () => {
    const { sourceStore, patchStore, activity, dispose } = initTestSystem();
    await sourceStore.testReceive(project(1_000));
    sourceStore.allEntriesProgress();

    const before = activity.position();
    await patchStore.createPatch("/page.val.ts", [
      { op: "replace", path: ["title"], value: "Featured!" },
    ]);
    sourceStore.allEntriesProgress();
    sourceStore.entriesStatus([mfp("/posts.val.ts")]);

    expect(
      activity.count("source:count-entries", {
        since: before,
        subject: "/posts.val.ts",
      }),
    ).toBe(0);
    // The edited module is counted again, and it is the size of the page,
    // not of the record it points at.
    expect(activity.total("source:count-entries", { since: before })).toBe(2);
    dispose();
  });

  it("counts again when an entry arrives, and when a fetch fails", async () => {
    const { sourceStore, jsonEntries, dispose } = initTestSystem();
    await sourceStore.testReceive(project(3));
    expect(sourceStore.allEntriesProgress()).toEqual({
      total: 3,
      loaded: 0,
      failed: 0,
    });

    await sourceStore.loadEntries(mfp("/posts.val.ts"), ["/post-0"]);
    expect(sourceStore.allEntriesProgress()).toEqual({
      total: 3,
      loaded: 1,
      failed: 0,
    });

    jsonEntries.failFor("/posts.val.ts", "/post-1", "the network is down");
    await sourceStore.loadEntries(mfp("/posts.val.ts"), ["/post-1"]);
    expect(sourceStore.allEntriesProgress()).toEqual({
      total: 3,
      loaded: 1,
      failed: 1,
    });
    expect(sourceStore.entriesStatus([mfp("/posts.val.ts")])).toEqual({
      status: "error",
      errors: [
        {
          moduleFilePath: "/posts.val.ts",
          key: "/post-1",
          message: "the network is down",
        },
      ],
    });
    dispose();
  });
});
