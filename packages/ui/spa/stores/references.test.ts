import { initVal } from "@valbuild/core";
import { initTestSystem, mfp, sp } from "./testSystem";

/**
 * The references store: who points at this thing?
 *
 * Three questions in the app today, each with its own whole-project walk called
 * from its own React hook: `getKeysOf` (which `s.keyOf()` fields name this
 * record), `getReferencedFiles` (which image/file fields name this gallery), and
 * `getRouteReferences` (which `s.route()` fields hold this route). All three walk
 * every leaf of every module, on every render of the component that asks, and
 * none of them can say whether their answer is complete.
 *
 * Two things make that worth replacing rather than moving:
 *
 * - **The answers gate destructive actions.** "Delete this key" and "rename this
 *   route" are only safe if the referrer list is exhaustive, and a walk over a
 *   partially loaded `.jsonValues()` record is not. `useJsonValuesLoad.ts`
 *   already states the contract — "anything that deletes or renames on the
 *   strength of a scan must gate on `status === 'success'`, not on
 *   `refs.length`" — and it has to be the store that knows, because only the
 *   store knows what is loaded.
 * - **The index is per module, so a keystroke costs one module.** A referrer is a
 *   LEAF fact (this path, this kind, this target, this value), so the walk can be
 *   indexed exactly the way the search index is: keep which entries came from
 *   which module, and re-walk only the module that changed.
 */

const routerModule = () => {
  const { c, s } = initVal();
  return c.define("/pages.val.ts", s.record(s.string()), {
    "/home": "Home",
    "/about": "About",
  });
};

/** Fields pointing AT `/pages.val.ts` — the referrers a scan has to find. */
const referrersModule = () => {
  const { c, s } = initVal();
  return c.define(
    "/nav.val.ts",
    s.object({
      primary: s.keyOf(routerModule()),
      secondary: s.keyOf(routerModule()),
      heading: s.string(),
    }),
    { primary: "/home", secondary: "/about", heading: "Main nav" },
  );
};

/** A second referrer module, so "only the changed module is re-walked" is testable. */
const moreReferrersModule = () => {
  const { c, s } = initVal();
  return c.define(
    "/footer.val.ts",
    s.object({ link: s.keyOf(routerModule()) }),
    { link: "/home" },
  );
};

/** No referrers at all: the common case, and it must cost nothing extra. */
const plainModule = () => {
  const { c, s } = initVal();
  return c.define("/about.val.ts", s.object({ title: s.string() }), {
    title: "About us",
  });
};

describe("finding who references a record", () => {
  it("finds every keyOf field pointing at the record", async () => {
    const { sourceStore, findReferences, dispose } = initTestSystem();
    await sourceStore.testReceive([
      routerModule(),
      referrersModule(),
      plainModule(),
    ]);

    const found = await findReferences({
      kind: "keyOf",
      module: mfp("/pages.val.ts"),
    });

    expect(found.status).toBe("complete");
    expect(found.refs.sort()).toEqual([
      '/nav.val.ts?p="primary"',
      '/nav.val.ts?p="secondary"',
    ]);
    dispose();
  });

  /**
   * The narrowed question, which is the one a delete actually asks: not "who
   * points at this record" but "who points at THIS KEY of it". Deleting `/about`
   * must not be blocked by a field pointing at `/home`.
   */
  it("narrows to the referrers of one key", async () => {
    const { sourceStore, findReferences, dispose } = initTestSystem();
    await sourceStore.testReceive([routerModule(), referrersModule()]);

    const found = await findReferences({
      kind: "keyOf",
      module: mfp("/pages.val.ts"),
      value: "/about",
    });

    expect(found.refs).toEqual(['/nav.val.ts?p="secondary"']);
    dispose();
  });

  it("finds nothing, definitively, when nothing points at it", async () => {
    const { sourceStore, findReferences, dispose } = initTestSystem();
    await sourceStore.testReceive([routerModule(), plainModule()]);

    const found = await findReferences({
      kind: "keyOf",
      module: mfp("/pages.val.ts"),
    });

    // `complete` is the whole point: an empty list from a complete scan means
    // "safe to delete", and an empty list from an incomplete one means nothing.
    expect(found).toEqual({ status: "complete", refs: [] });
    dispose();
  });

  it("sees a referrer that was added by a patch", async () => {
    const { sourceStore, patchStore, findReferences, dispose } =
      initTestSystem();
    await sourceStore.testReceive([routerModule(), referrersModule()]);
    await findReferences({ kind: "keyOf", module: mfp("/pages.val.ts") });

    await patchStore.createPatch("/nav.val.ts", [
      { op: "replace", path: ["primary"], value: "/about" },
    ]);

    const found = await findReferences({
      kind: "keyOf",
      module: mfp("/pages.val.ts"),
      value: "/about",
    });

    expect(found.refs.sort()).toEqual([
      '/nav.val.ts?p="primary"',
      '/nav.val.ts?p="secondary"',
    ]);
    dispose();
  });
});

describe("references are indexed per module", () => {
  /** A query is what pays. Editing must not walk anything. */
  it("scans nothing until asked", async () => {
    const { sourceStore, patchStore, activity, dispose } = initTestSystem();
    await sourceStore.testReceive([routerModule(), referrersModule()]);

    for (let index = 0; index < 5; index++) {
      await patchStore.createPatch("/nav.val.ts", [
        { op: "replace", path: ["heading"], value: `nav ${index}` },
      ]);
    }

    expect(activity.count("references:scan-module")).toBe(0);
    dispose();
  });

  it("scans every module on the first query", async () => {
    const { sourceStore, findReferences, activity, dispose } = initTestSystem();
    await sourceStore.testReceive([
      routerModule(),
      referrersModule(),
      moreReferrersModule(),
      plainModule(),
    ]);

    await findReferences({ kind: "keyOf", module: mfp("/pages.val.ts") });

    expect(activity.count("references:scan-module")).toBe(4);
    dispose();
  });

  it("re-scans only the edited module on the next query", async () => {
    const { sourceStore, patchStore, findReferences, activity, dispose } =
      initTestSystem();
    await sourceStore.testReceive([
      routerModule(),
      referrersModule(),
      moreReferrersModule(),
      plainModule(),
    ]);
    await findReferences({ kind: "keyOf", module: mfp("/pages.val.ts") });

    const before = activity.position();
    await patchStore.createPatch("/nav.val.ts", [
      { op: "replace", path: ["primary"], value: "/about" },
    ]);
    await findReferences({ kind: "keyOf", module: mfp("/pages.val.ts") });

    // One module of four. This is the claim the whole per-module index exists to
    // support — the old scans re-walked the project for a change to one string.
    expect(activity.count("references:scan-module", { since: before })).toBe(1);
    expect(
      activity.count("references:scan-module", {
        since: before,
        subject: "/nav.val.ts",
      }),
    ).toBe(1);
    dispose();
  });

  it("does not re-scan when a second query follows an unchanged one", async () => {
    const { sourceStore, findReferences, activity, dispose } = initTestSystem();
    await sourceStore.testReceive([routerModule(), referrersModule()]);
    await findReferences({ kind: "keyOf", module: mfp("/pages.val.ts") });

    const before = activity.position();
    await findReferences({ kind: "keyOf", module: mfp("/pages.val.ts") });
    await findReferences({
      kind: "keyOf",
      module: mfp("/pages.val.ts"),
      value: "/home",
    });

    // Two more queries, including a differently-shaped one, and no walking:
    // the index is over referrer FACTS, so a narrower question is a filter.
    expect(activity.count("references:scan-module", { since: before })).toBe(0);
    dispose();
  });

  it("drops a module's referrers when it is scanned again without them", async () => {
    const { sourceStore, patchStore, findReferences, dispose } =
      initTestSystem();
    await sourceStore.testReceive([routerModule(), referrersModule()]);
    await findReferences({ kind: "keyOf", module: mfp("/pages.val.ts") });

    // `secondary` no longer points at `/about`.
    await patchStore.createPatch("/nav.val.ts", [
      { op: "replace", path: ["secondary"], value: "/home" },
    ]);

    const found = await findReferences({
      kind: "keyOf",
      module: mfp("/pages.val.ts"),
      value: "/about",
    });

    // A stale referrer is the dangerous direction: it blocks a delete that is
    // in fact safe, and the user has no way to see why.
    expect(found.refs).toEqual([]);
    dispose();
  });
});

describe("file and route references", () => {
  const galleryModule = () => {
    const { c, s } = initVal();
    return c.define(
      "/gallery.val.ts",
      s.record(
        s.object({
          width: s.number(),
          height: s.number(),
          mimeType: s.string(),
          alt: s.string().nullable(),
        }),
      ),
      {},
    );
  };

  it("finds image fields pointing at a gallery module", async () => {
    const { sourceStore, findReferences, dispose } = initTestSystem();
    const { c, s } = initVal();
    const gallery = galleryModule();
    const page = c.define(
      "/page.val.ts",
      s.object({
        hero: s.image(gallery),
        other: s.string(),
      }),
      {
        hero: c.image("/public/val/hero.png", {
          width: 1,
          height: 1,
          mimeType: "image/png",
        }),
        other: "text",
      },
    );

    await sourceStore.testReceive([gallery, page]);
    const found = await findReferences({
      kind: "file",
      module: mfp("/gallery.val.ts"),
    });

    expect(found.status).toBe("complete");
    expect(found.refs).toEqual(['/page.val.ts?p="hero"']);
    dispose();
  });

  it("narrows file references to one file ref", async () => {
    const { sourceStore, findReferences, dispose } = initTestSystem();
    const { c, s } = initVal();
    const gallery = galleryModule();
    const page = c.define(
      "/page.val.ts",
      s.object({
        a: s.image(gallery),
        b: s.image(gallery),
      }),
      {
        a: c.image("/public/val/a.png", {
          width: 1,
          height: 1,
          mimeType: "image/png",
        }),
        b: c.image("/public/val/b.png", {
          width: 1,
          height: 1,
          mimeType: "image/png",
        }),
      },
    );

    await sourceStore.testReceive([gallery, page]);
    const found = await findReferences({
      kind: "file",
      module: mfp("/gallery.val.ts"),
      value: "/public/val/b.png",
    });

    expect(found.refs).toEqual(['/page.val.ts?p="b"']);
    dispose();
  });

  /**
   * `route` is the asymmetric one, and the store must not pretend otherwise:
   * `SerializedRouteSchema` carries include/exclude patterns and NOT the module
   * it points into, so a route reference can only be matched by comparing the
   * field's string value to the route key.
   */
  it("finds route fields by their value, since the schema names no target", async () => {
    const { sourceStore, findReferences, dispose } = initTestSystem();
    const { c, s } = initVal();
    const nav = c.define(
      "/routes.val.ts",
      s.object({ first: s.route(), second: s.route() }),
      { first: "/home", second: "/about" },
    );

    await sourceStore.testReceive([nav]);
    const found = await findReferences({ kind: "route", value: "/about" });

    expect(found.refs).toEqual(['/routes.val.ts?p="second"']);
    dispose();
  });
});

describe("a scan over unloaded `.jsonValues()` content is not complete", () => {
  const jsonValuesReferrers = () => {
    const { c, s } = initVal();
    return c.define(
      "/blogs.val.ts",
      s
        .record(s.object({ title: s.string(), page: s.keyOf(routerModule()) }))
        .jsonValues(),
      {
        "/a": c.json(() =>
          Promise.resolve({ default: { title: "Alpha", page: "/about" } }),
        ),
      },
    );
  };

  /**
   * The reason this store owns completeness rather than reporting a bare array.
   *
   * The referrer is INSIDE an unloaded entry, so the walk cannot see it. An empty
   * answer here would read as "safe to delete `/about`" and would be wrong.
   */
  it("reports partial when a jsonValues module could hide a referrer", async () => {
    const { sourceStore, findReferences, dispose } = initTestSystem();
    await sourceStore.testReceive([routerModule(), jsonValuesReferrers()]);

    const found = await findReferences({
      kind: "keyOf",
      module: mfp("/pages.val.ts"),
    });

    expect(found.status).toBe("partial");
    if (found.status !== "partial") {
      throw new Error("expected a partial scan");
    }
    expect(found.awaiting).toEqual(["/blogs.val.ts"]);
    dispose();
  });

  it("is complete once the entry content is loaded, and finds the referrer", async () => {
    const { sourceStore, findReferences, dispose } = initTestSystem();
    await sourceStore.testReceive([routerModule(), jsonValuesReferrers()]);
    await findReferences({ kind: "keyOf", module: mfp("/pages.val.ts") });

    sourceStore.receiveJsonEntry("/blogs.val.ts", "/a", {
      title: "Alpha",
      page: "/about",
    });

    const found = await findReferences({
      kind: "keyOf",
      module: mfp("/pages.val.ts"),
    });

    expect(found.status).toBe("complete");
    expect(found.refs).toEqual(['/blogs.val.ts?p="/a"."page"']);
    dispose();
  });

  /**
   * The direction argument, which is what stops this being "load the whole
   * project before you can delete anything".
   *
   * A jsonValues record whose item schema contains no referrer of this kind
   * cannot hide one, so it does not have to be loaded. `jsonValuesLoadRequirements`
   * already establishes this; the store has to honour it or the gate becomes
   * useless in practice.
   */
  it("is complete despite unloaded entries that cannot hide a referrer", async () => {
    const { sourceStore, findReferences, dispose } = initTestSystem();
    const { c, s } = initVal();
    const noReferrers = c.define(
      "/notes.val.ts",
      s.record(s.object({ body: s.string() })).jsonValues(),
      {
        "/one": c.json(() => Promise.resolve({ default: { body: "hello" } })),
      },
    );

    await sourceStore.testReceive([routerModule(), noReferrers]);
    const found = await findReferences({
      kind: "keyOf",
      module: mfp("/pages.val.ts"),
    });

    expect(found).toEqual({ status: "complete", refs: [] });
    dispose();
  });

  /**
   * And a found reference is reported even while the scan is partial.
   *
   * A ref that IS found is real. Hiding it until everything is loaded would show
   * "no references" for a record that visibly has them.
   */
  it("reports the referrers it did find while still partial", async () => {
    const { sourceStore, findReferences, dispose } = initTestSystem();
    await sourceStore.testReceive([
      routerModule(),
      referrersModule(),
      jsonValuesReferrers(),
    ]);

    const found = await findReferences({
      kind: "keyOf",
      module: mfp("/pages.val.ts"),
    });

    expect(found.status).toBe("partial");
    expect(found.refs.sort()).toEqual([
      '/nav.val.ts?p="primary"',
      '/nav.val.ts?p="secondary"',
    ]);
    dispose();
  });
});

describe("references at a path", () => {
  /**
   * The inverse question, which `KeyOfField` and the validation fixes need:
   * given a path, what does the field there point at? Answered from the same
   * index, because it is the same fact read the other way round.
   */
  it("answers what a single field points at", async () => {
    const { sourceStore, referenceAt, dispose } = initTestSystem();
    await sourceStore.testReceive([routerModule(), referrersModule()]);

    const at = await referenceAt(sp('/nav.val.ts?p="secondary"'));

    expect(at).toEqual({
      kind: "keyOf",
      target: "/pages.val.ts",
      value: "/about",
    });
    dispose();
  });

  it("answers null for a field that references nothing", async () => {
    const { sourceStore, referenceAt, dispose } = initTestSystem();
    await sourceStore.testReceive([routerModule(), referrersModule()]);

    expect(await referenceAt(sp('/nav.val.ts?p="heading"'))).toBeNull();
    dispose();
  });
});

/**
 * The replacement has to agree with what it replaces.
 *
 * These pin the new store against the three functions the app uses today, on the
 * same input. Not a substitute for the specs above — those describe what the
 * store adds (completeness, per-module scanning, one index for three questions) —
 * but the guard that says the answers themselves did not change while all that
 * was being built. A reference scan gates deletes, so "faster and differently
 * wrong" is the failure to be afraid of.
 */
describe("agrees with the scans it replaces", () => {
  /** A module whose ROOT is a keyOf: the reference path is the bare module path. */
  it("finds a root-level keyOf, pathed at the module itself", async () => {
    const { sourceStore, findReferences, dispose } = initTestSystem();
    const { c, s } = initVal();
    const target = c.define("/path1.val.ts", s.record(s.object({})), {
      test1: {},
    });
    const referrer = c.define("/path2.val.ts", s.keyOf(target), "test1");

    await sourceStore.testReceive([target, referrer]);
    const found = await findReferences({
      kind: "keyOf",
      module: mfp("/path1.val.ts"),
    });

    // Matches `getKeysOf`'s own test: the path is the module, not `?p=`.
    expect(found.refs).toEqual(["/path2.val.ts"]);
    dispose();
  });

  it("finds a keyOf inside an array of objects", async () => {
    const { sourceStore, findReferences, dispose } = initTestSystem();
    const { c, s } = initVal();
    const target = c.define("/keys.val.ts", s.record(s.string()), {
      a: "A",
      b: "B",
    });
    const referrer = c.define(
      "/rows.val.ts",
      s.array(s.object({ key: s.keyOf(target) })),
      [{ key: "a" }, { key: "b" }, { key: "a" }],
    );

    await sourceStore.testReceive([target, referrer]);
    const found = await findReferences({
      kind: "keyOf",
      module: mfp("/keys.val.ts"),
      value: "a",
    });

    expect(found.refs.sort()).toEqual([
      '/rows.val.ts?p=0."key"',
      '/rows.val.ts?p=2."key"',
    ]);
    dispose();
  });

  /**
   * A union: only the variant the source actually is has the referrer, and the
   * walk must find it without resolving the discriminant. Over-walking a union
   * costs a few misses; resolving it wrongly loses a referrer, and a lost
   * referrer is a delete that should have been blocked.
   */
  it("finds a keyOf inside the taken branch of a union", async () => {
    const { sourceStore, findReferences, dispose } = initTestSystem();
    const { c, s } = initVal();
    const target = c.define("/keys.val.ts", s.record(s.string()), { a: "A" });
    const referrer = c.define(
      "/blocks.val.ts",
      s.array(
        s.union(
          "type",
          s.object({ type: s.literal("link"), key: s.keyOf(target) }),
          s.object({ type: s.literal("text"), body: s.string() }),
        ),
      ),
      [
        { type: "text", body: "hello" },
        { type: "link", key: "a" },
      ],
    );

    await sourceStore.testReceive([target, referrer]);
    const found = await findReferences({
      kind: "keyOf",
      module: mfp("/keys.val.ts"),
    });

    expect(found.refs).toEqual(['/blocks.val.ts?p=1."key"']);
    dispose();
  });

  /** An empty referrer is still a referrer of the record, just not of any key. */
  it("records an empty keyOf as pointing at the record but at no key", async () => {
    const { sourceStore, findReferences, dispose } = initTestSystem();
    const { c, s } = initVal();
    const target = c.define("/keys.val.ts", s.record(s.string()), { a: "A" });
    const referrer = c.define(
      "/opt.val.ts",
      s.object({ key: s.keyOf(target).nullable() }),
      { key: null },
    );

    await sourceStore.testReceive([target, referrer]);

    expect(
      (await findReferences({ kind: "keyOf", module: mfp("/keys.val.ts") }))
        .refs,
    ).toEqual(['/opt.val.ts?p="key"']);
    // ...and deleting key `a` is not blocked by it.
    expect(
      (
        await findReferences({
          kind: "keyOf",
          module: mfp("/keys.val.ts"),
          value: "a",
        })
      ).refs,
    ).toEqual([]);
    dispose();
  });
});
