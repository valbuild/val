import { initVal } from "@valbuild/core";
import { initTestSystem, mfp, sp } from "./testSystem";

/**
 * Render and search are the two most expensive things in the system, and neither
 * should ever run because something CHANGED. They should run because someone is
 * looking.
 *
 * The demand signal for a render is a listener existing at a path — not a caller
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
 * cannot be done by simply rendering more.
 */

/** A module whose render counts how many items `select` was run over. */
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
    s.array(s.object({ title: s.string() })).render({
      as: "list",
      select: ({ val }) => {
        calls++;
        return { title: val.title };
      },
    }),
    items,
  );
  return { module, selectCalls: () => calls };
}

function plainModule(path: string) {
  const { c, s } = initVal();
  return c.define(path, s.object({ title: s.string() }), { title: "Hello" });
}

describe("render is driven by demand, not by change", () => {
  /** GUARD: nothing renders on its own. */
  it("does not render a module nobody is listening to", async () => {
    const { sourceStore, patchStore, activity, dispose } = initTestSystem();
    const { module } = listModule(3);

    await sourceStore.testReceive([module]);
    for (let index = 0; index < 5; index++) {
      await patchStore.createPatch("/list.val.ts", [
        { op: "replace", path: ["0", "title"], value: `edit ${index}` },
      ]);
    }

    expect(activity.count("host:execute-render")).toBe(0);
    dispose();
  });

  /**
   * SPEC: a listener appearing at a path is what asks for the render.
   *
   * This is the "user clicks to a path that needs a render" case. Nobody calls
   * `get()` here — a field mounted, and that alone should be enough for the
   * render to be ready when it looks.
   */
  it("renders when a listener appears at a path", async () => {
    const { sourceStore, renderStore, activity, listeners, ledger, dispose } =
      initTestSystem();
    const { module } = listModule(3);

    await sourceStore.testReceive([module]);
    expect(activity.count("host:execute-render")).toBe(0);

    listeners.set("/list.val.ts?p=1");

    await ledger.has({
      type: "render:result",
      moduleFilePath: "/list.val.ts",
    });
    expect(activity.count("host:execute-render")).toBe(1);
    // `peek` never triggers work, so this asserts the render is genuinely ready
    // rather than merely obtainable.
    expect(renderStore.peek(sp("/list.val.ts?p=1")).status).toBe("rendered");
    dispose();
  });

  /**
   * SPEC: after a change, the next read recomputes — once, however many changes.
   *
   * Deliberately not "the change recomputes". An earlier draft of this test
   * asserted that, and the 40-keystroke guard in `activityCost.test.ts` caught
   * it immediately: recomputing on change costs one whole-module render per
   * keystroke, which is the exact cost this design exists to remove. A change
   * marks; demand computes. Nothing is lost, because the change wakes the
   * fields on the affected paths and a woken field re-reads.
   */
  it("recomputes on the first read after a change, once", async () => {
    const {
      sourceStore,
      patchStore,
      renderStore,
      activity,
      listeners,
      dispose,
    } = initTestSystem();
    const { module } = listModule(3);

    await sourceStore.testReceive([module]);
    listeners.set("/list.val.ts?p=1");
    await renderStore.get(sp("/list.val.ts?p=1"));

    const beforeEdits = activity.position();
    for (let index = 0; index < 3; index++) {
      await patchStore.createPatch("/list.val.ts", [
        { op: "replace", path: ["1", "title"], value: `changed ${index}` },
      ]);
    }
    // Three changes, no reads: nothing recomputed.
    expect(activity.count("host:execute-render", { since: beforeEdits })).toBe(
      0,
    );

    const beforeRead = activity.position();
    await renderStore.get(sp("/list.val.ts?p=1"));
    // One read, one render, covering all three changes.
    expect(activity.count("host:execute-render", { since: beforeRead })).toBe(
      1,
    );
    dispose();
  });

  /**
   * GUARD: the complement of the SPEC above. Re-rendering on change must be
   * gated on demand, or "re-render what is listened to" becomes "re-render
   * everything", which is the behaviour this design exists to replace.
   */
  it("does not re-render a module whose listeners have all gone", async () => {
    const {
      sourceStore,
      patchStore,
      renderStore,
      activity,
      listeners,
      dispose,
    } = initTestSystem();
    const { module } = listModule(3);

    await sourceStore.testReceive([module]);
    const listener = listeners.set("/list.val.ts?p=1");
    await renderStore.get(sp("/list.val.ts?p=1"));

    listener.unsubscribe();
    const before = activity.position();
    await patchStore.createPatch("/list.val.ts", [
      { op: "replace", path: ["1", "title"], value: "changed" },
    ]);

    expect(activity.count("host:execute-render", { since: before })).toBe(0);
    dispose();
  });

  /** GUARD: demand in one module never pays for another. */
  it("does not render a module because another one is listened to", async () => {
    const { sourceStore, renderStore, activity, listeners, dispose } =
      initTestSystem();

    await sourceStore.testReceive([
      plainModule("/a.val.ts"),
      plainModule("/b.val.ts"),
    ]);
    listeners.set('/a.val.ts?p="title"');
    await renderStore.get(sp('/a.val.ts?p="title"'));

    expect(
      activity.count("host:execute-render", { subject: "/b.val.ts" }),
    ).toBe(0);
    dispose();
  });

  /**
   * SPEC, NOT YET IMPLEMENTED — and `it.failing` is deliberate.
   *
   * One listener, on one row of a three-row list. `select` is the user's own
   * closure and the actual expense — `handboka` has it at two nested array
   * levels — so counting `select` invocations is the only honest measure of
   * whether a render is path-scoped. It currently runs 3 times to serve 1
   * listened row.
   *
   * Marked `failing` rather than deleted or loosened, because this is the one
   * item here that cannot be fixed inside `packages/ui`. `ArraySchema`'s list
   * render is `src.map(select)` — the payload IS the whole list — so scoping it
   * means making a list render WINDOWED, which changes what a list render is,
   * across the ~16 schema classes that implement `executeRender`. That is the
   * decision `openquestions.md` item 3 reserves: "decide whether this experiment
   * is allowed to change `packages/core`".
   *
   * `it.failing` is the right encoding for that state: the expectation stays
   * written down and checked, and the day someone makes renders path-scoped this
   * test FAILS — telling them to delete the marker — instead of silently
   * continuing to pass.
   */
  it.failing("runs select only for the path being listened to", async () => {
    const { sourceStore, renderStore, listeners, dispose } = initTestSystem();
    const { module, selectCalls } = listModule(3);

    await sourceStore.testReceive([module]);
    listeners.set("/list.val.ts?p=1");
    await renderStore.get(sp("/list.val.ts?p=1"));

    expect(selectCalls()).toBe(1);
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
   * rule as the render: the change marks, the demand computes.
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
