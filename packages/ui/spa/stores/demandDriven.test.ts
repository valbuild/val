import { initVal } from "@valbuild/core";
import { initTestSystem, sp } from "./testSystem";

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
   * SPEC: a change to a module someone IS looking at re-renders it, once.
   *
   * Today the render store marks the module stale and stops there, so the render
   * on screen stays wrong until something calls `get()` again.
   */
  it("re-renders a listened module when its source changes", async () => {
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
    const before = activity.position();

    await patchStore.createPatch("/list.val.ts", [
      { op: "replace", path: ["1", "title"], value: "changed" },
    ]);

    expect(activity.count("host:execute-render", { since: before })).toBe(1);
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
   * SPEC: the render is scoped to what is being looked at.
   *
   * One listener, on one row of a three-row list. `select` is the user's own
   * closure and the actual expense — `handboka` has it at two nested array
   * levels — so the count of `select` invocations is the real measure of whether
   * a render is path-scoped.
   *
   * `executeRender` takes a whole module and walks every item, so this is the
   * known `packages/core` gap stated as a number: 3 items looked at to serve 1.
   * It is the difference between per-visible-row and per-module.
   */
  it("runs select only for the path being listened to", async () => {
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
    const { sourceStore, searchStore, activity, dispose } = initTestSystem();

    await sourceStore.testReceive([plainModule("/a.val.ts")]);
    const result = await searchStore.search("Hello");

    expect(result.status).toBe("results");
    expect(activity.count("search:build-index")).toBe(1);
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
    const { sourceStore, searchStore, activity, dispose } = initTestSystem();

    await sourceStore.testReceive([plainModule("/a.val.ts")]);
    await searchStore.search("Hello");
    const before = activity.position();

    const second = await searchStore.search("Hello");

    expect(second.status).toBe("results");
    expect(activity.count("search:build-index", { since: before })).toBe(0);
    dispose();
  });

  /**
   * SPEC: a query after an edit rebuilds, once, at the point of the query.
   *
   * The rebuild is owed to the edit but paid at the query — which is the same
   * rule as the render: the change marks, the demand computes.
   */
  it("rebuilds once on the first query after an edit", async () => {
    const { sourceStore, patchStore, searchStore, activity, dispose } =
      initTestSystem();

    await sourceStore.testReceive([plainModule("/a.val.ts")]);
    await searchStore.search("Hello");

    await patchStore.createPatch("/a.val.ts", [
      { op: "replace", path: ["title"], value: "Goodbye" },
    ]);
    const before = activity.position();

    const found = await searchStore.search("Goodbye");

    expect(activity.count("search:build-index", { since: before })).toBe(1);
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
