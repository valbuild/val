import { initVal } from "@valbuild/core";
import { initTestSystem, mfp, sp } from "./testSystem";

/**
 * Preview and search are the two most expensive things in the system, and neither
 * should ever run because something CHANGED. They should run because someone is
 * looking.
 *
 * The demand signal for a preview is a listener existing at a path — not a caller
 * happening to invoke `get()`. That distinction is the whole point: `get()` is a
 * caller choosing to pay, so nothing stops a speculative or unmounted caller
 * paying for a whole module. A registered listener is the system's own record of
 * "a field is on screen showing this path", so it is the only signal that can be
 * trusted to mean the work is wanted.
 *
 * The demand signal for search is a query.
 *
 * Tests marked SPEC describe wiring that does not exist yet and are expected to
 * fail. Tests marked GUARD pass today and are here so that satisfying a SPEC
 * cannot be done by simply previewing more.
 */

/** A module whose preview counts how many items the closure was run over. */
function listModule(itemCount: number): {
  module: ReturnType<ReturnType<typeof initVal>["c"]["define"]>;
  selectCalls: () => number;
} {
  const { c, s } = initVal();
  let calls = 0;
  const items = Array.from({ length: itemCount }, (_unused, index) => ({
    title: `item ${index}`,
  }));
  const module = c.define(
    "/list.val.ts",
    s.array(s.object({ title: s.string() })).preview(({ val }) => {
      calls++;
      return { title: val.title };
    }),
    items,
  );
  return { module, selectCalls: () => calls };
}

function plainModule(path: string) {
  const { c, s } = initVal();
  return c.define(path, s.object({ title: s.string() }), { title: "Hello" });
}

describe("preview is driven by demand, not by change", () => {
  /** GUARD: nothing previews on its own. */
  it("does not preview a module nobody is listening to", async () => {
    const { sourceStore, patchStore, activity, dispose } = initTestSystem();
    const { module } = listModule(3);

    await sourceStore.testReceive([module]);
    for (let index = 0; index < 5; index++) {
      await patchStore.createPatch("/list.val.ts", [
        { op: "replace", path: ["0", "title"], value: `edit ${index}` },
      ]);
    }

    expect(activity.count("host:execute-preview")).toBe(0);
    dispose();
  });

  /**
   * SPEC: a listener appearing at a path is what asks for the preview.
   *
   * This is the "user clicks to a path that needs a preview" case. Nobody calls
   * `get()` here — a field mounted, and that alone should be enough for the
   * preview to be ready when it looks.
   */
  it("previews when a listener appears at a path", async () => {
    const { sourceStore, previewStore, activity, listeners, ledger, dispose } =
      initTestSystem();
    const { module } = listModule(3);

    await sourceStore.testReceive([module]);
    expect(activity.count("host:execute-preview")).toBe(0);

    listeners.set("/list.val.ts?p=1");

    await ledger.has({
      type: "preview:result",
      moduleFilePath: "/list.val.ts",
    });
    expect(activity.count("host:execute-preview")).toBe(1);
    // `peek` never triggers work, so this asserts the preview is genuinely ready
    // rather than merely obtainable.
    expect(previewStore.peek(sp("/list.val.ts?p=1")).status).toBe("previewed");
    dispose();
  });

  /**
   * SPEC: after a change, the next read recomputes — once, however many changes.
   *
   * Deliberately not "the change recomputes". An earlier draft of this test
   * asserted that, and the 40-keystroke guard in `activityCost.test.ts` caught
   * it immediately: recomputing on change costs one whole-module preview per
   * keystroke, which is the exact cost this design exists to remove. A change
   * marks; demand computes. Nothing is lost, because the change wakes the
   * fields on the affected paths and a woken field re-reads.
   */
  it("recomputes on the first read after a change, once", async () => {
    const {
      sourceStore,
      patchStore,
      previewStore,
      activity,
      listeners,
      dispose,
    } = initTestSystem();
    const { module } = listModule(3);

    await sourceStore.testReceive([module]);
    listeners.set("/list.val.ts?p=1");
    await previewStore.get(sp("/list.val.ts?p=1"));

    const beforeEdits = activity.position();
    for (let index = 0; index < 3; index++) {
      await patchStore.createPatch("/list.val.ts", [
        { op: "replace", path: ["1", "title"], value: `changed ${index}` },
      ]);
    }
    // Three changes, no reads: nothing recomputed.
    expect(activity.count("host:execute-preview", { since: beforeEdits })).toBe(
      0,
    );

    const beforeRead = activity.position();
    await previewStore.get(sp("/list.val.ts?p=1"));
    // One read, one preview, covering all three changes.
    expect(activity.count("host:execute-preview", { since: beforeRead })).toBe(
      1,
    );
    dispose();
  });

  /**
   * GUARD: the complement of the SPEC above. Recomputing on change must be
   * gated on demand, or "re-preview what is listened to" becomes "re-preview
   * everything", which is the behaviour this design exists to replace.
   */
  it("does not re-preview a module whose listeners have all gone", async () => {
    const {
      sourceStore,
      patchStore,
      previewStore,
      activity,
      listeners,
      dispose,
    } = initTestSystem();
    const { module } = listModule(3);

    await sourceStore.testReceive([module]);
    const listener = listeners.set("/list.val.ts?p=1");
    await previewStore.get(sp("/list.val.ts?p=1"));

    listener.unsubscribe();
    const before = activity.position();
    await patchStore.createPatch("/list.val.ts", [
      { op: "replace", path: ["1", "title"], value: "changed" },
    ]);

    expect(activity.count("host:execute-preview", { since: before })).toBe(0);
    dispose();
  });

  /** GUARD: demand in one module never pays for another. */
  it("does not preview a module because another one is listened to", async () => {
    const { sourceStore, previewStore, activity, listeners, dispose } =
      initTestSystem();

    await sourceStore.testReceive([
      plainModule("/a.val.ts"),
      plainModule("/b.val.ts"),
    ]);
    listeners.set('/a.val.ts?p="title"');
    await previewStore.get(sp('/a.val.ts?p="title"'));

    expect(
      activity.count("host:execute-preview", { subject: "/b.val.ts" }),
    ).toBe(0);
    dispose();
  });

  /**
   * One listener, on one row of a three-row list. `select` is the user's own
   * closure and the actual expense — `handboka` has it at two nested array
   * levels — so counting `select` invocations is the only honest measure of
   * whether a preview is path-scoped.
   *
   * This was `it.failing` while previews were whole-module: it ran 3 times to
   * serve 1 listened row. `PreviewScope` is what closed it — `ArraySchema`'s
   * preview is now WINDOWED, carrying only the rows that were asked for, which is
   * why `ArrayPreview.items` pairs each item with its index.
   */
  it("runs select only for the path being listened to", async () => {
    const { sourceStore, previewStore, listeners, dispose } = initTestSystem();
    const { module, selectCalls } = listModule(3);

    await sourceStore.testReceive([module]);
    listeners.set("/list.val.ts?p=1");
    await previewStore.get(sp("/list.val.ts?p=1"));

    expect(selectCalls()).toBe(1);
    dispose();
  });

  /**
   * The complement, and the reason the scope has TWO questions rather than one.
   *
   * A list VIEW asks for the container, and it needs every row — a windowed
   * answer there would be a list with rows missing. So `wants(containerPath)`
   * means the whole list, and only a request for descendants alone windows it.
   * Without this the fix for the test above would just be "preview less", which
   * breaks the screen that renders lists.
   */
  it("runs select for every row when the list itself is what is asked for", async () => {
    const { sourceStore, previewStore, listeners, dispose } = initTestSystem();
    const { module, selectCalls } = listModule(3);

    await sourceStore.testReceive([module]);
    listeners.set("/list.val.ts");
    const read = await previewStore.get(sp("/list.val.ts"));

    expect(selectCalls()).toBe(3);
    if (read.status !== "previewed" || read.preview.status !== "success") {
      throw new Error("expected the list to preview");
    }
    const data = read.preview.data;
    if (data.parent !== "array" || data.parent !== "array") {
      throw new Error("expected an array preview");
    }
    expect(data.items.map(([index]) => index)).toEqual([0, 1, 2]);
    dispose();
  });

  /**
   * And the windowed preview says WHICH rows it carries.
   *
   * The reason `ArrayPreview.items` became `[index, value][]`: a windowed
   * preview is a shorter array, so a consumer reading `items[n]` positionally
   * would silently get a different row. Carrying the index makes that
   * unrepresentable — the two call sites in the UI became lookups, and the
   * compiler pointed at both.
   */
  it("labels a windowed list preview with the indices it covers", async () => {
    const { sourceStore, previewStore, listeners, dispose } = initTestSystem();
    const { module } = listModule(3);

    await sourceStore.testReceive([module]);
    listeners.set("/list.val.ts?p=1");
    const read = await previewStore.get(sp("/list.val.ts?p=1"));

    if (read.status !== "previewed" || read.preview.status !== "success") {
      throw new Error("expected a preview");
    }
    const data = read.preview.data;
    if (data.parent !== "array" || data.parent !== "array") {
      throw new Error("expected an array preview");
    }
    expect(data.items).toEqual([[1, { title: "item 1" }]]);
    dispose();
  });

  /**
   * Two rows visible, read concurrently: ONE preview, covering both.
   *
   * The case that makes scoping worth having rather than a way to preview twice.
   * A scoped preview's coverage is fixed when it is issued, so a reader that
   * arrives after that either gets an answer about someone else's path or needs
   * its own preview — which for a scrolling list would be one preview per row.
   * `refreshFor` collects the asked-for paths across the turn and issues once.
   */
  it("serves concurrent readers of different rows with one preview", async () => {
    const { sourceStore, previewStore, activity, listeners, dispose } =
      initTestSystem();
    const { module, selectCalls } = listModule(10);

    await sourceStore.testReceive([module]);
    listeners.set("/list.val.ts?p=3");
    listeners.set("/list.val.ts?p=4");
    const before = activity.position();

    await Promise.all([
      previewStore.get(sp("/list.val.ts?p=3")),
      previewStore.get(sp("/list.val.ts?p=4")),
    ]);

    // The eager preview on the first `listeners.set` saw only row 3, so the reads
    // owe one more pass — but one, not one each, and it covers both rows.
    expect(activity.count("host:execute-preview", { since: before })).toBe(1);
    // Two rows of ten. `select` ran for those two and no others.
    expect(selectCalls()).toBeLessThanOrEqual(4);
    const read = await previewStore.get(sp("/list.val.ts?p=4"));
    if (read.status !== "previewed" || read.preview.status !== "success") {
      throw new Error("expected row 4 to be covered");
    }
    const data = read.preview.data;
    if (data.parent !== "array" || data.parent !== "array") {
      throw new Error("expected an array preview");
    }
    expect(data.items.map(([index]) => index)).toEqual([3, 4]);
    dispose();
  });

  /**
   * SPEC: a row that scrolls into view says `needs-preview`, not `previewed`.
   *
   * The one case where nothing else asks on the reader's behalf. A field
   * mounting is normally what triggers the preview, but `source:listen`
   * deliberately returns early once the module has one — that is the coalescing
   * that makes twenty mounting rows cost two previews instead of twenty — so the
   * new row's own read is the only thing left that can widen the scope. It only
   * reads when `peek` tells it to, and `peek` used to answer `previewed` here:
   * the WINDOWED container preview is keyed under the container, so the fallback
   * found it, even though its `items` do not contain this row. The row then sat
   * with no preview until something else in the module changed.
   */
  it("reports needs-preview for a row outside the previewed scope", async () => {
    const { sourceStore, previewStore, activity, listeners, ledger, dispose } =
      initTestSystem();
    const { module } = listModule(10);

    await sourceStore.testReceive([module]);
    listeners.set("/list.val.ts?p=3");
    await ledger.has({
      type: "preview:result",
      moduleFilePath: "/list.val.ts",
    });
    expect(previewStore.peek(sp("/list.val.ts?p=3")).status).toBe("previewed");

    // Row 7 scrolls into view. Its listener does NOT trigger a preview, so the
    // cached one still only covers row 3.
    const before = activity.position();
    listeners.set("/list.val.ts?p=7");
    expect(activity.count("host:execute-preview", { since: before })).toBe(0);

    expect(previewStore.peek(sp("/list.val.ts?p=7")).status).toBe(
      "needs-preview",
    );

    // And asking resolves it, in one preview, without leaving row 3 behind.
    const read = await previewStore.get(sp("/list.val.ts?p=7"));
    expect(activity.count("host:execute-preview", { since: before })).toBe(1);
    if (read.status !== "previewed" || read.preview.status !== "success") {
      throw new Error(`expected row 7 to be covered, got ${read.status}`);
    }
    const data = read.preview.data;
    if (data.parent !== "array" || data.parent !== "array") {
      throw new Error("expected an array preview");
    }
    expect(data.items.map(([index]) => index)).toEqual([3, 7]);
    expect(previewStore.peek(sp("/list.val.ts?p=7")).status).toBe("previewed");
    dispose();
  });
});

describe("search is driven by demand, not by change", () => {
  /** GUARD: editing never indexes. */
  it("does not index because the source changed", async () => {
    const { sourceStore, patchStore, activity, dispose } = initTestSystem();

    await sourceStore.testReceive([plainModule("/a.val.ts")]);
    for (let index = 0; index < 5; index++) {
      await patchStore.createPatch("/a.val.ts", [
        { op: "replace", path: ["title"], value: `edit ${index}` },
      ]);
    }

    expect(activity.count("search:build-index")).toBe(0);
    expect(activity.count("search:gather-snapshot")).toBe(0);
    dispose();
  });

  /**
   * SPEC: the query is the demand signal, so the first query builds the index.
   *
   * Today `search()` answers `no-index` unless someone separately called
   * `buildSearchIndex()` first — so the caller has to know to prime it, and a
   * caller that forgets gets an empty answer rather than a slow one. An empty
   * answer is the worse failure: it looks like "no results".
   */
  it("builds the index on the first query", async () => {
    const { sourceStore, search, activity, dispose } = initTestSystem();

    await sourceStore.testReceive([plainModule("/a.val.ts")]);
    const result = await search("Hello");

    expect(result.status).toBe("results");
    // Counted per module, because indexing IS per module now — there is no
    // whole-project build on the query path to count.
    expect(activity.count("search:index-module")).toBe(1);
    dispose();
  });

  /**
   * SPEC: having built it, a second query with nothing changed reuses it.
   *
   * The result status is asserted as well as the count, and that is not
   * decoration: "did not rebuild" is trivially true of a system that never
   * built an index at all, so without it this test passes for the very
   * behaviour the SPEC above says is wrong.
   */
  it("does not rebuild for a second query when nothing changed", async () => {
    const { sourceStore, search, activity, dispose } = initTestSystem();

    await sourceStore.testReceive([plainModule("/a.val.ts")]);
    await search("Hello");
    const before = activity.position();

    const second = await search("Hello");

    expect(second.status).toBe("results");
    expect(activity.count("search:index-module", { since: before })).toBe(0);
    expect(activity.count("search:gather-snapshot", { since: before })).toBe(0);
    dispose();
  });

  /**
   * SPEC: a query after an edit rebuilds, once, at the point of the query.
   *
   * The rebuild is owed to the edit but paid at the query — which is the same
   * rule as the preview: the change marks, the demand computes.
   */
  it("rebuilds once on the first query after an edit", async () => {
    const { sourceStore, patchStore, search, activity, dispose } =
      initTestSystem();

    await sourceStore.testReceive([plainModule("/a.val.ts")]);
    await search("Hello");

    await patchStore.createPatch("/a.val.ts", [
      { op: "replace", path: ["title"], value: "Goodbye" },
    ]);
    const before = activity.position();

    const found = await search("Goodbye");

    expect(activity.count("search:index-module", { since: before })).toBe(1);
    if (found.status !== "results") {
      throw new Error("expected results");
    }
    // Rebuilt at the point of the query, so nothing is left stale behind it.
    expect(found.staleModules).toEqual([]);
    dispose();
  });

  /** GUARD: no query, no index, however many edits. */
  it("never indexes if nobody ever searches", async () => {
    const { sourceStore, patchStore, activity, dispose } = initTestSystem();

    await sourceStore.testReceive([
      plainModule("/a.val.ts"),
      plainModule("/b.val.ts"),
    ]);
    for (let index = 0; index < 10; index++) {
      await patchStore.createPatch("/a.val.ts", [
        { op: "replace", path: ["title"], value: `edit ${index}` },
      ]);
    }

    expect(activity.count("search:gather-snapshot")).toBe(0);
    expect(activity.count("search:build-index")).toBe(0);
    dispose();
  });
});

describe("search reindexes per module", () => {
  const three = () => [
    plainModule("/a.val.ts"),
    plainModule("/b.val.ts"),
    plainModule("/c.val.ts"),
  ];

  it("indexes every module on the first query", async () => {
    const { sourceStore, search, activity, dispose } = initTestSystem();

    await sourceStore.testReceive(three());
    await search("Hello");

    expect(activity.count("search:index-module")).toBe(3);
    dispose();
  });

  /**
   * The point of the whole thing: editing one field of one module must not
   * re-walk every leaf of every other module. Indexing is the most expensive
   * walk in the system, so paying for it in full to serve a one-character
   * change is the shape of problem this design exists to remove.
   */
  it("reindexes only the edited module on the next query", async () => {
    const { sourceStore, patchStore, search, activity, dispose } =
      initTestSystem();

    await sourceStore.testReceive(three());
    await search("Hello");

    await patchStore.createPatch("/b.val.ts", [
      { op: "replace", path: ["title"], value: "Goodbye" },
    ]);
    const before = activity.position();
    const found = await search("Goodbye");

    expect(activity.count("search:index-module", { since: before })).toBe(1);
    expect(
      activity.count("search:index-module", {
        since: before,
        subject: "/b.val.ts",
      }),
    ).toBe(1);
    // And the gather — the one whole-project copy — is scoped to it too.
    expect(activity.count("search:gather-snapshot", { since: before })).toBe(1);
    if (found.status !== "results") {
      throw new Error("expected results");
    }
    expect(found.results.length).toBeGreaterThan(0);
    dispose();
  });

  /** The edit has to actually be findable, or "reindexed one module" is a lie. */
  it("makes the edited value findable and drops the old one", async () => {
    const { sourceStore, patchStore, search, dispose } = initTestSystem();

    await sourceStore.testReceive(three());
    await search("Hello");

    await patchStore.createPatch("/b.val.ts", [
      { op: "replace", path: ["title"], value: "Zebra" },
    ]);

    const zebra = await search("Zebra");
    if (zebra.status !== "results") {
      throw new Error("expected results");
    }
    expect(zebra.results.map((hit) => hit.path)).toEqual([
      '/b.val.ts?p="title"',
    ]);

    // The other two still hold "Hello"; the edited one must no longer.
    const hello = await search("Hello");
    if (hello.status !== "results") {
      throw new Error("expected results");
    }
    expect(hello.results.map((hit) => hit.path).sort()).toEqual([
      '/a.val.ts?p="title"',
      '/c.val.ts?p="title"',
    ]);
    dispose();
  });
});

describe("search reindexes exactly the modules that changed", () => {
  const three = () => [
    plainModule("/a.val.ts"),
    plainModule("/b.val.ts"),
    plainModule("/c.val.ts"),
  ];

  it("reindexes both changed modules and leaves the third alone", async () => {
    const { sourceStore, patchStore, search, activity, dispose } =
      initTestSystem();

    await sourceStore.testReceive(three());
    await search("Hello");

    await patchStore.createPatch("/a.val.ts", [
      { op: "replace", path: ["title"], value: "Alpha" },
    ]);
    await patchStore.createPatch("/c.val.ts", [
      { op: "replace", path: ["title"], value: "Gamma" },
    ]);
    const before = activity.position();
    await search("Alpha");

    expect(activity.count("search:index-module", { since: before })).toBe(2);
    expect(
      activity.count("search:index-module", {
        since: before,
        subject: "/b.val.ts",
      }),
    ).toBe(0);
    dispose();
  });

  /**
   * Staleness is a set, so 40 keystrokes in one module owe ONE index pass. If
   * this counted edits instead, indexing would be back on the keystroke path by
   * a slower route.
   */
  it("indexes once however many times a module changed", async () => {
    const { sourceStore, patchStore, search, activity, dispose } =
      initTestSystem();

    await sourceStore.testReceive(three());
    await search("Hello");

    for (let index = 0; index < 5; index++) {
      await patchStore.createPatch("/b.val.ts", [
        { op: "replace", path: ["title"], value: `Edit ${index}` },
      ]);
    }
    const before = activity.position();
    await search("Edit");

    expect(activity.count("search:index-module", { since: before })).toBe(1);
    dispose();
  });

  it("indexes a module that arrived after the index was built", async () => {
    const { sourceStore, search, activity, dispose } = initTestSystem();

    await sourceStore.testReceive([plainModule("/a.val.ts")]);
    await search("Hello");

    await sourceStore.testReceive([plainModule("/late.val.ts")]);
    const before = activity.position();
    const found = await search("Hello");

    // The new module is walked; the one already indexed is not walked again.
    expect(
      activity.count("search:index-module", {
        since: before,
        subject: "/late.val.ts",
      }),
    ).toBe(1);
    expect(
      activity.count("search:index-module", {
        since: before,
        subject: "/a.val.ts",
      }),
    ).toBe(0);
    if (found.status !== "results") {
      throw new Error("expected results");
    }
    expect(found.results.map((hit) => hit.path).sort()).toEqual([
      '/a.val.ts?p="title"',
      '/late.val.ts?p="title"',
    ]);
    dispose();
  });

  /**
   * A module that has gone away, as distinct from one that changed. Leaving its
   * documents in place keeps them searchable, and a hit on one navigates to a
   * path that no longer exists — which is worse than a missing result, because it
   * looks like a broken link rather than an empty search.
   */
  it("drops a forgotten module's documents and leaves the rest searchable", async () => {
    const { sourceStore, searchStore, search, dispose } = initTestSystem();

    await sourceStore.testReceive(three());
    const before = await search("Hello");
    if (before.status !== "results") {
      throw new Error("expected results");
    }
    expect(before.results).toHaveLength(3);

    searchStore.forget(mfp("/b.val.ts"));

    const after = await search("Hello");
    if (after.status !== "results") {
      throw new Error("expected results");
    }
    expect(after.results.map((hit) => hit.path).sort()).toEqual([
      '/a.val.ts?p="title"',
      '/c.val.ts?p="title"',
    ]);
    dispose();
  });
});
