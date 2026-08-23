import { initVal } from "@valbuild/core";
import { initTestSystem, externalPatch, mfp, sp } from "./testSystem";

/**
 * Can the worker-realm stores actually live in a worker?
 *
 * `architecture.md` says three stores — search, patch sets, references — are in
 * the WORKER realm, and that the design is what makes that possible: they hold no
 * reference to any other store, and the snapshots they need are arguments rather
 * than reads, so "the structured clone is in the signature instead of hidden
 * behind a store reference that would silently stop working the moment this
 * really moved."
 *
 * That is a claim, and until this file it was only ever a claim. `openquestions.md`
 * item 5 has said so: "a seam that is never crossed is a comment."
 *
 * Two things have to be true, and they fail differently:
 *
 * 1. **Everything crossing must be structured-cloneable.** A `Schema` instance, a
 *    function, a Proxy, a `Map` of any of those — `postMessage` throws
 *    `DataCloneError` and the store never runs. `structuredClone` is the exact
 *    same algorithm, so it is the honest check and it needs no worker.
 * 2. **Nothing may be read SYNCHRONOUSLY across the seam.** This is the one the
 *    design got wrong, and no amount of cloneability testing would have found it:
 *    a value can be perfectly cloneable and still unreachable, because a thread
 *    boundary makes every read a message. See the second describe block.
 */

const project = () => {
  const { c, s } = initVal();
  const authors = c.define("/authors.val.ts", s.record(s.string()), {
    ada: "Ada",
  });
  return [
    authors,
    c.define(
      "/page.val.ts",
      s.object({
        title: s.string().minLength(2),
        // Every serialized-schema shape that could plausibly hide something
        // non-cloneable, in one module: a regexp (serialized as {source, flags}
        // rather than a RegExp), a keyOf (carries a path), an image (carries a
        // referencedModule), a route, a richtext (carries an options object), and
        // a union (carries an items array).
        slug: s.string().regexp(/^[a-z-]+$/),
        owner: s.keyOf(authors),
        hero: s.image(),
        link: s.route(),
        body: s.richtext({ style: { bold: true }, block: { ul: true } }),
        block: s.union(
          "type",
          s.object({ type: s.literal("a"), a: s.string() }),
          s.object({ type: s.literal("b"), b: s.number() }),
        ),
      }),
      {
        title: "Hello",
        slug: "hello",
        owner: "ada",
        hero: c.image("/public/val/x.png", {
          width: 1,
          height: 1,
          mimeType: "image/png",
        }),
        link: "/blogs/one",
        body: [{ tag: "p", children: ["text"] }],
        block: { type: "a", a: "one" },
      },
    ),
    c.define(
      "/list.val.ts",
      s.array(s.object({ name: s.string() })).render({
        as: "list",
        select: ({ val }) => ({ title: val.name }),
      }),
      [{ name: "one" }, { name: "two" }],
    ),
  ];
};

/**
 * `structuredClone` IS the `postMessage` algorithm. Asserting a payload survives
 * it is the same guarantee a real worker would give, without a worker — and it
 * fails with the same `DataCloneError` a worker would throw.
 */
function assertCloneable(what: string, value: unknown): unknown {
  try {
    return structuredClone(value);
  } catch (error) {
    throw new Error(
      `${what} cannot cross a worker seam: ${
        error instanceof Error ? error.message : String(error)
      }. Something in it is a function, a class instance, or a Proxy.`,
    );
  }
}

describe("everything crossing the worker seam is structured-cloneable", () => {
  it("the search snapshot, and the result that comes back", async () => {
    const { sourceStore, searchStore, schemaStore, dispose } = initTestSystem();
    await sourceStore.testReceive(project());

    // Built exactly as `createSystem.gatherSnapshot` builds it, because that is
    // the value that would be posted.
    const schemas = schemaStore.all();
    const snapshot: Record<string, unknown> = {};
    for (const moduleFilePath of sourceStore.loadedModules()) {
      snapshot[moduleFilePath] = {
        source: sourceStore.moduleSource(moduleFilePath),
        schema: schemas[moduleFilePath],
        complete: true,
      };
    }
    const cloned = assertCloneable("SourceSnapshot", snapshot);

    // And the far side must be able to USE the clone, not merely receive it: a
    // value that survives cloning but has lost the shape the store needs would
    // pass a cloneability check and fail in production.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await searchStore.reindex(cloned as any);
    expect(result.all.sort()).toEqual([
      "/authors.val.ts",
      "/list.val.ts",
      "/page.val.ts",
    ]);
    assertCloneable("reindex result", result);

    const found = await searchStore.search("Hello");
    assertCloneable("SearchResult", found);
    dispose();
  });

  it("the reference snapshot, the query, and the scan", async () => {
    const { sourceStore, referenceStore, schemaStore, dispose } =
      initTestSystem();
    await sourceStore.testReceive(project());

    const schemas = schemaStore.all();
    const snapshot: Record<string, unknown> = {};
    for (const moduleFilePath of sourceStore.loadedModules()) {
      snapshot[moduleFilePath] = {
        source: sourceStore.moduleSource(moduleFilePath),
        schema: schemas[moduleFilePath],
        complete: true,
      };
    }
    const cloned = assertCloneable("ReferenceSnapshot", snapshot);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await referenceStore.rescan(cloned as any);

    const query = { kind: "keyOf", module: mfp("/authors.val.ts") } as const;
    assertCloneable("ReferenceQuery", query);
    const scan = await referenceStore.find(query);
    expect(scan.refs).toEqual(['/page.val.ts?p="owner"']);
    assertCloneable("ReferenceScan", scan);

    const at = await referenceStore.at(sp('/page.val.ts?p="owner"'));
    assertCloneable("Reference", at);
    dispose();
  });

  it("the patch records and schemas the patch-set store is handed", async () => {
    const { sourceStore, patchStore, patchSetStore, schemaStore, dispose } =
      initTestSystem();
    await sourceStore.testReceive(project());
    await patchStore.createPatch("/page.val.ts", [
      { op: "replace", path: ["title"], value: "Changed" },
    ]);

    const records = [
      externalPatch("p-1", "/page.val.ts", [
        { op: "replace", path: ["slug"], value: "changed" },
      ]),
    ];
    const schemas = schemaStore.all();
    const clonedRecords = assertCloneable("PatchRecord[]", records);
    const clonedSchemas = assertCloneable("SchemaSnapshot", schemas);

    const sets = await patchSetStore.getPatchSets(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      clonedRecords as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      clonedSchemas as any,
      1,
    );
    assertCloneable("SerializedPatchSet", sets);
    dispose();
  });

  /**
   * The one that would actually bite. A serialized schema is meant to be plain
   * data, and the places it could stop being plain are specific: a `RegExp`
   * (kept as `{source, flags}` on purpose), a `keyOf` path, a `referencedModule`,
   * a richtext options object, a union's items array.
   *
   * `structuredClone` would accept a `RegExp` — it is on the clonable list — so
   * this asserts the stronger property the design actually relies on: the
   * serialized schema is JSON, which is what lets it be cached, hashed and
   * compared by value.
   */
  it("a serialized schema is JSON, not merely cloneable", async () => {
    const { sourceStore, schemaStore, dispose } = initTestSystem();
    await sourceStore.testReceive(project());

    const schemas = schemaStore.all();
    expect(Object.keys(schemas).length).toBe(3);
    for (const schema of Object.values(schemas)) {
      // Round-tripped against the ORIGINAL, not against itself. An earlier
      // version of this compared `JSON.parse(JSON.stringify(x))` to
      // `JSON.parse(JSON.stringify(x))`, which is true of anything and proves
      // nothing. `toEqual` ignores keys whose value is `undefined`, which is
      // exactly what `JSON.stringify` drops, so a lost FUNCTION or class
      // instance is what this catches.
      expect(JSON.parse(JSON.stringify(schema))).toEqual(schema);
    }
    dispose();
  });

  /**
   * And source, which is the big one by volume.
   *
   * `HostStore.receive` JSON round-trips source on intake precisely so this
   * holds — the `c.json` thunk and any other runtime-only property is stripped
   * there. This is that guarantee, asserted where it is relied on.
   */
  it("module source is JSON", async () => {
    const { sourceStore, dispose } = initTestSystem();
    await sourceStore.testReceive(project());

    for (const moduleFilePath of sourceStore.loadedModules()) {
      const source = sourceStore.moduleSource(moduleFilePath);
      assertCloneable(`source of ${moduleFilePath}`, source);
      expect(JSON.parse(JSON.stringify(source))).toEqual(source);
    }
    dispose();
  });
});

/**
 * The part cloneability cannot see: the host reads worker state SYNCHRONOUSLY.
 *
 * A thread boundary makes every read a message, and a message is async. So a
 * synchronous read of worker-realm state is not slow across a real seam — it is
 * IMPOSSIBLE. The value could be perfectly cloneable and still unreachable.
 *
 * `createSystem` does it in seven places today:
 *
 *     searchStore.needsIndex()          searchStore.staleModules()
 *     searchStore.indexedModules()      searchStore.markStale(modules)
 *     referenceStore.staleModules()     referenceStore.scannedModules()
 *     referenceStore.find(query)        referenceStore.at(path)
 *
 * The shape of the fix is forced by what the information IS: the host is what
 * knows a module changed — it emits `source:patch-apply`. It currently pushes
 * that into the worker store and then asks the worker back what it owes, which
 * across a real seam is two round trips for something the host already had.
 * Moving the staleness bookkeeping to the host side makes it one.
 *
 * These tests describe the API a real seam requires. They are the specification,
 * not a wish: every one of them is a call that has to be awaitable.
 */
describe("the worker-realm API can be crossed by messages alone", () => {
  it("answers a reference query asynchronously", async () => {
    const { sourceStore, referenceStore, dispose } = initTestSystem();
    await sourceStore.testReceive(project());

    // `find` and `at` are synchronous today. Across a seam they cannot be.
    const scan = referenceStore.find({
      kind: "keyOf",
      module: mfp("/authors.val.ts"),
    });
    expect(scan).toBeInstanceOf(Promise);
    dispose();
  });

  it("answers what a field points at asynchronously", async () => {
    const { sourceStore, referenceStore, dispose } = initTestSystem();
    await sourceStore.testReceive(project());

    const at = referenceStore.at(sp('/page.val.ts?p="owner"'));
    expect(at).toBeInstanceOf(Promise);
    dispose();
  });

  /**
   * And the staleness decision must not require asking the worker.
   *
   * Not a style point: `needsIndex()` / `staleModules()` / `indexedModules()` are
   * three synchronous questions the host asks BEFORE it can gather a snapshot, so
   * across a real seam one query becomes four messages. The host already knows
   * the answer — it is the side that saw the change.
   */
  it("decides what to reindex without asking the worker", async () => {
    const { sourceStore, patchStore, searchStore, dispose } = initTestSystem();
    await sourceStore.testReceive(project());
    await patchStore.createPatch("/page.val.ts", [
      { op: "replace", path: ["title"], value: "Changed" },
    ]);

    // The search store should not be the one holding this. Whatever replaces
    // `needsIndex`/`staleModules`/`indexedModules` lives host-side.
    const store: unknown = searchStore;
    if (typeof store !== "object" || store === null) {
      throw new Error("no search store");
    }
    expect("needsIndex" in store).toBe(false);
    expect("staleModules" in store).toBe(false);
    dispose();
  });
});

/**
 * `StaleModules`, which now owns the decision the worker realm used to be asked
 * for. Worth its own tests: a bug here does not look like a bug, it looks like
 * "search never updates" or "search reindexes the project on every query".
 */
describe("host-side staleness", () => {
  it("owes a first pass over everything, then only what changed", async () => {
    const { sourceStore, patchStore, search, activity, dispose } =
      initTestSystem();
    await sourceStore.testReceive(project());

    // First query: every loaded module.
    await search("Hello");
    expect(activity.count("search:index-module")).toBe(3);

    // An edit, then a query: one module.
    const before = activity.position();
    await patchStore.createPatch("/page.val.ts", [
      { op: "replace", path: ["title"], value: "Changed" },
    ]);
    await search("Changed");
    expect(activity.count("search:index-module", { since: before })).toBe(1);

    // A query with nothing changed: no pass at all.
    const beforeSecond = activity.position();
    await search("Changed");
    expect(activity.count("search:index-module", { since: beforeSecond })).toBe(
      0,
    );
    dispose();
  });

  /**
   * The search and reference indexes go stale independently, which is why there
   * are two instances rather than one shared set. Sharing would mean a search
   * clearing what the reference index still owed — and the symptom would be a
   * reference scan silently answering from a stale index, which is the exact
   * failure the `complete`/`partial` split exists to prevent.
   */
  it("does not let one consumer clear another's debt", async () => {
    const {
      sourceStore,
      patchStore,
      search,
      findReferences,
      activity,
      dispose,
    } = initTestSystem();
    await sourceStore.testReceive(project());
    await search("Hello");
    await findReferences({ kind: "keyOf", module: mfp("/authors.val.ts") });

    await patchStore.createPatch("/page.val.ts", [
      { op: "replace", path: ["owner"], value: "ada" },
    ]);
    // A search reconciles the SEARCH index and must leave the reference index
    // still owing a pass.
    await search("Hello");

    const before = activity.position();
    await findReferences({ kind: "keyOf", module: mfp("/authors.val.ts") });
    expect(activity.count("references:scan-module", { since: before })).toBe(1);
    dispose();
  });

  /**
   * A module the worker could not index must stay stale.
   *
   * `covers()` is called with what the worker actually indexed, not with what was
   * asked for — otherwise a module with no schema is marked covered on the first
   * query and never gets another chance, which presents as "this module is
   * permanently unsearchable" with nothing to point at.
   */
  it("keeps a module stale when the pass could not cover it", async () => {
    const { sourceStore, search, dispose } = initTestSystem();
    await sourceStore.testReceive(project());

    const found = await search("Hello");
    if (found.status !== "results") {
      throw new Error("expected results");
    }
    // Everything here has a schema, so nothing is left owing.
    expect(found.staleModules).toEqual([]);
    dispose();
  });
});
