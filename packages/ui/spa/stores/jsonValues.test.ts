import { initVal } from "@valbuild/core";
import { initTestSystem, mfp } from "./testSystem";

/**
 * `.jsonValues()` records, which this prototype does not handle at all.
 *
 * A `.jsonValues()` record keeps its entry CONTENT in separate `*.val.json`
 * files. The module's own source carries only opaque `{_type:"json"}` markers,
 * and content is fetched per entry on demand (`GET /json`). The existing engine
 * keeps that content beside source in `jsonEntryContents` and substitutes it in
 * `getPatchedSource`; the hypothesis in `architecture.md` is that the
 * substitution belongs in the source store, and that a READ at a path inside an
 * unloaded entry is the demand signal for fetching it.
 *
 * These tests are the shape of that, written now because two unfinished things
 * interact here and the interaction is easy to get wrong later:
 *
 * - The `absent` / `module-loading` split. A path inside a marker is UNKNOWN,
 *   not missing, and collapsing the two is the exact bug that split exists to
 *   prevent.
 * - The search index. The walk skips markers, so a `.jsonValues()` module is
 *   indexed PARTIALLY by construction — and nothing currently says so, which
 *   turns "not loaded yet" into "no results".
 *
 * Tests marked SPEC describe behaviour that does not exist and are expected to
 * fail. Tests marked GUARD hold today and pin what must not regress while the
 * SPECs are made to pass.
 */
const jsonValuesModule = () => {
  const { c, s } = initVal();
  return c.define(
    "/blogs.val.ts",
    s.record(s.object({ title: s.string(), body: s.string() })).jsonValues(),
    {
      "/a": c.json(() =>
        Promise.resolve({ default: { title: "Alpha", body: "First body" } }),
      ),
      "/b": c.json(() =>
        Promise.resolve({ default: { title: "Beta", body: "Second body" } }),
      ),
    },
  );
};

describe("reading a `.jsonValues()` record", () => {
  /**
   * GUARD: the KEY SET is loaded even when no content is.
   *
   * This is why load state cannot be per module: the same record answers
   * definitively about its keys and indefinitely about what is inside them.
   */
  it("resolves the record itself, so the keys are known", async () => {
    const { sourceStore, dispose } = initTestSystem();
    await sourceStore.testReceive([jsonValuesModule()]);

    const read = await sourceStore.get("/blogs.val.ts?p=", null);

    if (read.status !== "resolved-head") {
      throw new Error(`expected the record to resolve, got ${read.status}`);
    }
    expect(Object.keys(read.data as Record<string, unknown>).sort()).toEqual([
      "/a",
      "/b",
    ]);
    dispose();
  });

  /** GUARD: an entry's value IS the marker, until something loads it. */
  it("resolves an entry to its marker", async () => {
    const { sourceStore, dispose } = initTestSystem();
    await sourceStore.testReceive([jsonValuesModule()]);

    const read = await sourceStore.get('/blogs.val.ts?p="/a"', null);

    if (read.status !== "resolved-head") {
      throw new Error(`expected the entry to resolve, got ${read.status}`);
    }
    // Only the marker crossed intake: `HostStore.receive` JSON round-trips
    // source, which strips the runtime import thunk.
    expect(read.data).toEqual({ _type: "json" });
    dispose();
  });

  /**
   * SPEC: a path INSIDE an unloaded entry is not known to be absent — the read
   * FETCHES the content and resolves with it.
   *
   * `resolveAtModulePath` walks into the marker, finds no `title` key on it, and
   * says `absent` — which claims the field does not exist. It does exist; its
   * content has not been fetched. A field told `absent` renders "not found" and
   * stops asking, so the entry never loads and the content never appears.
   *
   * SUPERSEDES an earlier version of this spec that asserted `module-loading`.
   * That was wrong in a way worth recording: `module-loading` says "come back
   * later", and nothing tells a caller when later is, so a field would poll or
   * hang. It is the right answer for an unloaded MODULE, where a read genuinely
   * cannot help — here the module IS loaded, its schema IS known, and the store
   * can fetch. `get` is already async, so the awaited call IS the loading state;
   * `peek` below is what observes it without paying for it.
   */
  it("fetches the entry and resolves a path inside it", async () => {
    const { sourceStore, jsonEntries, dispose } = initTestSystem();
    await sourceStore.testReceive([jsonValuesModule()]);

    // Before the read: the store says the content is missing, and says so
    // without fetching anything.
    expect(sourceStore.peek('/blogs.val.ts?p="/a"."title"')).toEqual({
      status: "entry-missing",
      key: "/a",
    });
    expect(jsonEntries.requests()).toEqual([]);

    const read = await sourceStore.get('/blogs.val.ts?p="/a"."title"', null);

    if (read.status !== "resolved-head") {
      throw new Error(`expected the read to resolve, got ${read.status}`);
    }
    expect(read.data).toEqual("Alpha");
    expect(jsonEntries.requests()).toEqual(["/blogs.val.ts\u0000/a"]);
    dispose();
  });

  /**
   * SPEC: the second reader of the same entry does not cause a second fetch.
   *
   * The read being the demand signal is what makes this the thing to pin: a
   * record rendering its entries mounts one field per key, and every one of them
   * reads on mount. N fields on one entry must be one request.
   */
  it("fetches an entry once for concurrent readers", async () => {
    const { sourceStore, activity, jsonEntries, dispose } = initTestSystem();
    await sourceStore.testReceive([jsonValuesModule()]);

    const reads = await Promise.all([
      sourceStore.get('/blogs.val.ts?p="/a"."title"', null),
      sourceStore.get('/blogs.val.ts?p="/a"."body"', null),
      sourceStore.get('/blogs.val.ts?p="/a"."title"', null),
    ]);

    expect(reads.map((read) => read.status)).toEqual([
      "resolved-head",
      "resolved-head",
      "resolved-head",
    ]);
    expect(jsonEntries.requests()).toEqual(["/blogs.val.ts\u0000/a"]);
    expect(activity.count("source:load-json-entry")).toBe(1);
    expect(activity.count("source:share-json-entry-load")).toBe(2);
    dispose();
  });

  /**
   * SPEC: a fetch that fails is an error, never `absent`.
   *
   * The distinction the whole `absent` / not-absent split exists for, at the one
   * seam that can genuinely fail. "Not found" is a fact about the content; a
   * failed request is a fact about the network, and a field shown "not found"
   * has nothing to retry.
   */
  it("reports an error when the entry fetch fails", async () => {
    const { sourceStore, jsonEntries, dispose } = initTestSystem();
    await sourceStore.testReceive([jsonValuesModule()]);
    jsonEntries.failFor("/blogs.val.ts", "/a", "the network is down");

    const read = await sourceStore.get('/blogs.val.ts?p="/a"."title"', null);

    expect(read).toEqual({ status: "error", message: "the network is down" });
    dispose();
  });

  /**
   * SPEC: and a path inside an entry that is genuinely absent stays `absent`.
   *
   * The complement, so that fixing the above cannot be done by making every read
   * inside a `.jsonValues()` record say `module-loading` forever — which would
   * trade a wrong "not found" for a permanent spinner.
   */
  it("still answers `absent` for a key the entry schema does not have", async () => {
    const { sourceStore, dispose } = initTestSystem();
    await sourceStore.testReceive([jsonValuesModule()]);

    const read = await sourceStore.get('/blogs.val.ts?p="/a"."nope"', null);

    expect(read.status).toBe("absent");
    dispose();
  });

  /**
   * SPEC: a key that is not an entry of the record is absent, definitively.
   *
   * The key set is loaded, so this one the store CAN answer.
   */
  it("answers `absent` for an entry key that does not exist", async () => {
    const { sourceStore, dispose } = initTestSystem();
    await sourceStore.testReceive([jsonValuesModule()]);

    const read = await sourceStore.get('/blogs.val.ts?p="/nope"', null);

    expect(read.status).toBe("absent");
    dispose();
  });
});

describe("searching a `.jsonValues()` record", () => {
  /**
   * GUARD: the walk skips markers, so nothing inside an entry is indexed.
   *
   * Not a defect on its own — there is nothing to index yet. It is the reason the
   * SPEC below matters.
   */
  it("indexes nothing inside an unloaded entry", async () => {
    const { sourceStore, search, dispose } = initTestSystem();
    await sourceStore.testReceive([jsonValuesModule()]);

    const found = await search("Alpha");

    if (found.status !== "results") {
      throw new Error("expected a result set");
    }
    expect(found.results).toEqual([]);
    dispose();
  });

  /**
   * SPEC: an empty result set from a partial index must not look like "nothing
   * matched".
   *
   * `SearchStore`'s own doc says a partial index "is the normal case, and
   * returning results without saying so is how 'search silently can't find
   * things' happens". `staleModules` cannot carry it: the module is not stale, it
   * is INCOMPLETE, and those need different answers — stale means "re-index me",
   * incomplete means "load more content first".
   */
  it("reports the module as incompletely indexed", async () => {
    const { sourceStore, search, dispose } = initTestSystem();
    await sourceStore.testReceive([jsonValuesModule()]);

    const found = await search("Alpha");

    if (found.status !== "results") {
      throw new Error("expected a result set");
    }
    // Whatever the field ends up being called, the claim is that the caller can
    // tell an incomplete index from an exhaustive one without guessing.
    expect(found).toHaveProperty("partialModules", ["/blogs.val.ts"]);
    dispose();
  });

  /**
   * SPEC: once an entry's content is loaded, its module is re-indexed and the
   * content becomes findable.
   *
   * This is the interaction the per-module reindex has to get right: entry
   * content arriving is a THIRD staleness source, alongside intake and edits, and
   * `docsByModule` has to grow on the second pass rather than the first pass's
   * emptiness being cached as complete.
   */
  it("finds entry content once it is loaded", async () => {
    const { sourceStore, search, activity, dispose } = initTestSystem();
    await sourceStore.testReceive([jsonValuesModule()]);
    await search("Alpha");

    // Delivered directly rather than by reading a path inside the entry, so that
    // what is under test is the ARRIVAL of content and not the fetch: a read
    // would prove both at once and neither on its own.
    sourceStore.receiveJsonEntry("/blogs.val.ts", "/a", {
      title: "Alpha",
      body: "First body",
    });

    const before = activity.position();
    const found = await search("Alpha");

    // One module re-walked, not the project: entry content arriving marks its own
    // module stale and nothing else.
    expect(activity.count("search:index-module", { since: before })).toBe(1);
    if (found.status !== "results") {
      throw new Error("expected a result set");
    }
    expect(found.results.map((hit) => hit.path)).toContain(
      '/blogs.val.ts?p="/a"."title"',
    );
    // Still partial: `/b` has not been loaded. The flag tracks the module, not
    // the query, so one loaded entry does not make the module complete.
    expect(found.partialModules).toEqual(["/blogs.val.ts"]);
    dispose();
  });

  /**
   * SPEC: and a module whose every entry is loaded stops being reported partial.
   *
   * The complement, so that `partialModules` cannot be satisfied by a flag that
   * is set once and never cleared — which would make every project with any
   * `.jsonValues()` record permanently "incompletely indexed" and the signal
   * worthless.
   */
  it("stops reporting the module partial once every entry is loaded", async () => {
    const { sourceStore, search, dispose } = initTestSystem();
    await sourceStore.testReceive([jsonValuesModule()]);
    await search("Alpha");

    sourceStore.receiveJsonEntry("/blogs.val.ts", "/a", {
      title: "Alpha",
      body: "First body",
    });
    sourceStore.receiveJsonEntry("/blogs.val.ts", "/b", {
      title: "Beta",
      body: "Second body",
    });

    const found = await search("Beta");

    if (found.status !== "results") {
      throw new Error("expected a result set");
    }
    expect(found.partialModules).toEqual([]);
    expect(found.results.map((hit) => hit.path)).toContain(
      '/blogs.val.ts?p="/b"."title"',
    );
    dispose();
  });
});

describe("validating a `.jsonValues()` record", () => {
  /**
   * SPEC: a module whose entries are markers must not be reported as valid.
   *
   * `collectCustomValidateTargets` already returns `needsJsonKeys` for exactly
   * this, and the validation store ignores it. A green module that was never
   * fully checked is the failure this store already refuses elsewhere — it
   * reports `customValidateStatus: "unavailable"` rather than silently dropping
   * the custom half. Unloaded entry content is the same problem with a different
   * cause.
   */
  it("does not claim a module with unloaded entries is fully validated", async () => {
    const { sourceStore, validationStore, dispose } = initTestSystem();
    await sourceStore.testReceive([jsonValuesModule()]);

    const result = await validationStore.validate(mfp("/blogs.val.ts"));

    if (result.status !== "validated") {
      throw new Error(`expected a validation result, got ${result.status}`);
    }
    // Whatever it is called, the claim is that "valid" and "valid as far as I
    // could see" are distinguishable.
    expect(result).toHaveProperty("jsonEntriesLoaded", false);
    dispose();
  });
});
