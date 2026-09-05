import {
  initVal,
  type Json,
  type ModuleFilePath,
  type PatchId,
  type SerializedSchema,
} from "@valbuild/core";
import type { Patch } from "@valbuild/core/patch";
import {
  draftKeyChanges,
  mergeExternalKeys,
  readExternalSource,
  resolveExternalEntries,
  validateExternalEntry,
} from "./externalReads";

const { s, c } = initVal();

const POSTS = "/content/posts.val.ts" as ModuleFilePath;

const schema = s.record(s.object({ title: s.string() })).external("posts");
const serializedSchema: SerializedSchema = schema["executeSerialize"]();
const marker = c.external();

const patch = (id: string, ops: Patch) => ({
  patchId: id as PatchId,
  patch: ops,
});

/** The common case: marker source, no drafts, content straight from the store. */
function resolve(
  keys: string[],
  fromStore: Record<string, Json | null>,
  overrides: Partial<Parameters<typeof resolveExternalEntries>[0]> = {},
) {
  return resolveExternalEntries({
    moduleFilePath: POSTS,
    schema,
    serializedSchema,
    source: marker,
    keys,
    fromStore,
    patches: [],
    applyPatches: true,
    ...overrides,
  });
}

describe("readExternalSource", () => {
  test("the marker means the entries are elsewhere", () => {
    expect(readExternalSource(marker)).toEqual({ kind: "marker" });
  });

  test("entries written inline are read as written", () => {
    // Legal at the type level (see InlineEntriesFor) and reported as a fix, not
    // as a broken module: content pasted into the `.val.ts` is what an author
    // writes first.
    const res = readExternalSource({ a: { title: "A" } });
    expect(res).toEqual({ kind: "inline", entries: { a: { title: "A" } } });
  });

  test("anything else is reported, not guessed at", () => {
    expect(readExternalSource(undefined).kind).toBe("invalid");
    expect(readExternalSource([]).kind).toBe("invalid");
    expect(readExternalSource("nope").kind).toBe("invalid");
  });
});

describe("draftKeyChanges", () => {
  test("an added key is reported, in the order it was added", () => {
    const changes = draftKeyChanges(serializedSchema, [
      patch("p1", [{ op: "add", path: ["b"], value: { title: "B" } }]),
      patch("p2", [{ op: "add", path: ["a"], value: { title: "A" } }]),
    ]);
    expect(changes.added).toEqual(["b", "a"]);
    expect(changes.removed.size).toBe(0);
  });

  test("a removed key is reported", () => {
    const changes = draftKeyChanges(serializedSchema, [
      patch("p1", [{ op: "remove", path: ["a"] }]),
    ]);
    expect([...changes.removed]).toEqual(["a"]);
  });

  test("add then remove leaves neither", () => {
    const changes = draftKeyChanges(serializedSchema, [
      patch("p1", [{ op: "add", path: ["a"], value: { title: "A" } }]),
      patch("p2", [{ op: "remove", path: ["a"] }]),
    ]);
    expect(changes.added).toEqual([]);
    expect([...changes.removed]).toEqual(["a"]);
  });

  test("remove then re-add resurrects the key", () => {
    // The ops are ordered, and the last one wins — otherwise deleting an entry
    // and typing it again would leave it invisible until publish.
    const changes = draftKeyChanges(serializedSchema, [
      patch("p1", [{ op: "remove", path: ["a"] }]),
      patch("p2", [{ op: "add", path: ["a"], value: { title: "A" } }]),
    ]);
    expect(changes.added).toEqual(["a"]);
    expect(changes.removed.size).toBe(0);
  });

  test("an edit INSIDE an entry changes no keys", () => {
    const changes = draftKeyChanges(serializedSchema, [
      patch("p1", [{ op: "replace", path: ["a", "title"], value: "A!" }]),
    ]);
    expect(changes.added).toEqual([]);
    expect(changes.removed.size).toBe(0);
  });

  test("with no schema, nothing can be classified", () => {
    // A module whose schema failed to serialize still reads; it just cannot
    // route patches. Degrading beats failing.
    expect(
      draftKeyChanges(undefined, [
        patch("p1", [{ op: "add", path: ["a"], value: 1 }]),
      ]).added,
    ).toEqual([]);
  });
});

describe("resolveExternalEntries", () => {
  test("content comes back from the store", () => {
    const res = resolve(["a"], { a: { title: "A" } });
    expect(res.entries).toEqual([{ key: "a", content: { title: "A" } }]);
    expect(res.missing).toEqual([]);
    expect(res.errors).toEqual([]);
  });

  test("a key the store does not have is missing, not null", () => {
    const res = resolve(["a"], { a: null });
    expect(res.entries).toEqual([]);
    expect(res.missing).toEqual(["a"]);
  });

  test("an inline entry SHADOWS the store", () => {
    // Otherwise moving content into a store would make the not-yet-moved half
    // disappear the moment the store answered for its key.
    const res = resolve(
      ["a"],
      { a: { title: "from the store" } },
      {
        source: { a: { title: "written inline" } },
      },
    );
    expect(res.entries).toEqual([
      { key: "a", content: { title: "written inline" } },
    ]);
  });

  test("an unpublished edit is applied on top of the store's content", () => {
    // The store has PUBLISHED content only. Without this an editor opens a
    // record and their own edit is missing.
    const res = resolve(
      ["a"],
      { a: { title: "old" } },
      {
        patches: [
          patch("p1", [{ op: "replace", path: ["a", "title"], value: "new" }]),
        ],
      },
    );
    expect(res.entries).toEqual([{ key: "a", content: { title: "new" } }]);
  });

  test("a key an unpublished edit ADDED resolves, though the store has nothing", () => {
    const res = resolve(
      ["a"],
      { a: null },
      {
        patches: [
          patch("p1", [{ op: "add", path: ["a"], value: { title: "A" } }]),
        ],
      },
    );
    expect(res.entries).toEqual([{ key: "a", content: { title: "A" } }]);
    expect(res.missing).toEqual([]);
  });

  test("a key an unpublished edit REMOVED reads as missing", () => {
    const res = resolve(
      ["a"],
      { a: { title: "A" } },
      {
        patches: [patch("p1", [{ op: "remove", path: ["a"] }])],
      },
    );
    expect(res.entries).toEqual([]);
    expect(res.missing).toEqual(["a"]);
  });

  test("apply_patches false leaves the store's content alone", () => {
    // The Studio owns its own in-flight patches; replaying them here too would
    // apply every edit twice.
    const res = resolve(
      ["a"],
      { a: { title: "old" } },
      {
        applyPatches: false,
        patches: [
          patch("p1", [{ op: "replace", path: ["a", "title"], value: "new" }]),
        ],
      },
    );
    expect(res.entries).toEqual([{ key: "a", content: { title: "old" } }]);
  });

  test("a row that no longer matches the schema is REPORTED and still returned", () => {
    // The store is not the repository: its rows can change under a schema that
    // no longer describes them. An editor has to see the row to fix it, and one
    // bad row must not leave a hole in the page.
    const res = resolve(["a", "b"], {
      a: { title: 42 },
      b: { title: "B" },
    });
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].key).toBe("a");
    expect(res.errors[0].message).toContain("does not match the schema");
    expect(res.entries.map((e) => e.key)).toEqual(["a", "b"]);
  });

  test("validation can be turned off", () => {
    const res = resolve(["a"], { a: { title: 42 } }, { validate: false });
    expect(res.errors).toEqual([]);
  });

  test("the adapter's own object is never mutated", () => {
    // An adapter is free to answer from a cache. Replaying a draft edit onto
    // that object would mutate the store's cached row.
    const row = { title: "old" };
    const fromStore = { a: row };
    resolve(["a"], fromStore, {
      patches: [
        patch("p1", [{ op: "replace", path: ["a", "title"], value: "new" }]),
      ],
    });
    expect(row.title).toBe("old");
  });

  test("with no schema the content is returned unvalidated", () => {
    const res = resolve(
      ["a"],
      { a: { title: 42 } },
      {
        schema: undefined,
        serializedSchema: undefined,
      },
    );
    expect(res.errors).toEqual([]);
    expect(res.entries).toEqual([{ key: "a", content: { title: 42 } }]);
  });
});

describe("validateExternalEntry", () => {
  test("says nothing about a schema it cannot use", () => {
    expect(
      validateExternalEntry(undefined, POSTS, "a", { title: "A" }),
    ).toBeNull();
    // Not a record: nothing to validate an ENTRY against.
    expect(
      validateExternalEntry(s.object({ a: s.string() }), POSTS, "a", {
        title: "A",
      }),
    ).toBeNull();
  });

  test("names the entry and the failing path", () => {
    const message = validateExternalEntry(schema, POSTS, "a", { title: 42 });
    expect(message).toContain("'a'");
    expect(message).toContain("title");
  });
});

describe("mergeExternalKeys", () => {
  const base = {
    fromStore: ["s1", "s2"],
    storeCursor: "next" as string | null,
    inline: [] as string[],
    draft: { added: [] as string[], removed: new Set<string>() },
    isFirstPage: true,
  };

  test("the store's page and cursor pass through", () => {
    expect(mergeExternalKeys(base)).toEqual({
      keys: ["s1", "s2"],
      cursor: "next",
    });
  });

  test("inline and draft-added keys go on the FIRST page", () => {
    // There is nowhere else to put them: the store's cursors are the store's,
    // and a key it has never heard of cannot be positioned within them.
    expect(
      mergeExternalKeys({
        ...base,
        inline: ["i1"],
        draft: { added: ["d1"], removed: new Set() },
      }).keys,
    ).toEqual(["i1", "d1", "s1", "s2"]);
  });

  test("and are NOT repeated on later pages", () => {
    expect(
      mergeExternalKeys({
        ...base,
        isFirstPage: false,
        fromStore: ["s3", "i1"],
        inline: ["i1"],
        draft: { added: ["d1"], removed: new Set() },
      }).keys,
    ).toEqual(["s3"]);
  });

  test("a draft-removed key is dropped wherever it came from", () => {
    expect(
      mergeExternalKeys({
        ...base,
        inline: ["i1"],
        draft: { added: [], removed: new Set(["s1", "i1"]) },
      }).keys,
    ).toEqual(["s2"]);
  });

  test("a key the store repeats is listed once", () => {
    expect(
      mergeExternalKeys({ ...base, fromStore: ["s1", "s1", "s2"] }).keys,
    ).toEqual(["s1", "s2"]);
  });
});
