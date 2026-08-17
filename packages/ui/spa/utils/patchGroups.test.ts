import { initVal } from "@valbuild/core";
import { JSONValue } from "@valbuild/core/patch";
import { runScenario } from "./patchGroupScenario";

const { s } = initVal();

/**
 * Scenarios for staging and unstaging patches (see
 * `docs/independent-publish/PLAN.md`).
 *
 * Read these top to bottom. Each one replays a sequence of edits by two or three
 * authors, applies each author's patch group for real, then publishes each
 * author's group in turn and checks that everybody else can carry on working.
 *
 * The inline snapshot in each test is the readable trace — it is there to be
 * reviewed, not just to pass. The `expect(problems).toEqual([])` next to it is
 * the hard assertion: a broken prefix invariant, a patch that will not apply, an
 * author's intent no longer holding, or two supposedly-independent changes that
 * cannot be published separately.
 *
 * The open question these are meant to settle is whether the prefix rule is
 * enough on its own, or whether there are orderings where both authors end up
 * having to carry each other. The first two scenarios are that question stated
 * as a pair.
 */

// The array schema used by most scenarios. Arrays are where the interdependence
// lives: an insert shifts every index after it, so `PatchSets` treats a whole
// array as one patch set.
const page = s.object({
  title: s.string(),
  items: s.array(s.object({ title: s.string() })),
});

const threeItems: JSONValue = {
  title: "Page",
  items: [{ title: "A" }, { title: "B" }, { title: "C" }],
};

describe("patch groups", () => {
  // #region the asymmetry
  test("edit-then-insert: the inserter carries the editor, not the other way round", () => {
    const { report, problems } = runScenario({
      name: "Bob renames an item, then Alice inserts above it",
      moduleFilePath: "/content/page.val.ts",
      schema: page,
      base: threeItems,
      render: renderTitles,
      patches: [
        {
          id: "p1",
          author: "bob",
          intent: 'rename "B" to "B*"',
          ops: [{ op: "replace", path: ["items", "1", "title"], value: "B*" }],
          holds: (doc) => hasTitle(doc, "B*") && !hasTitle(doc, "B"),
        },
        {
          id: "p2",
          author: "alice",
          intent: 'insert "New" at the top',
          ops: [{ op: "add", path: ["items", "0"], value: { title: "New" } }],
          holds: (doc) => titles(doc)[0] === "New",
        },
      ],
    });
    expect(problems).toEqual([]);
    expect(report).toMatchSnapshot();
  });

  test("insert-then-edit: the editor carries the inserter, mirroring the case above", () => {
    const { report, problems } = runScenario({
      name: "Alice inserts at the top, then Bob renames an item",
      moduleFilePath: "/content/page.val.ts",
      schema: page,
      base: threeItems,
      render: renderTitles,
      patches: [
        {
          id: "p1",
          author: "alice",
          intent: 'insert "New" at the top',
          ops: [{ op: "add", path: ["items", "0"], value: { title: "New" } }],
          holds: (doc) => titles(doc)[0] === "New",
        },
        {
          // Bob was forced to stage p1, so his view is [New, A, B, C] and "B" is
          // at index 2. That is the whole reason his index is 2 and not 1.
          id: "p2",
          author: "bob",
          intent: 'rename "B" to "B*"',
          ops: [{ op: "replace", path: ["items", "2", "title"], value: "B*" }],
          holds: (doc) => hasTitle(doc, "B*") && !hasTitle(doc, "B"),
        },
      ],
    });
    expect(problems).toEqual([]);
    expect(report).toMatchSnapshot();
  });
  // #endregion

  // #region what the feature is for
  test("separate fields: both authors publish alone", () => {
    const { report, problems } = runScenario({
      name: "Bob edits the page title, Alice edits an item title",
      moduleFilePath: "/content/page.val.ts",
      schema: page,
      base: threeItems,
      render: renderTitles,
      independent: [["p1", "p2"]],
      patches: [
        {
          id: "p1",
          author: "bob",
          intent: "retitle the page",
          ops: [{ op: "replace", path: ["title"], value: "Page*" }],
          holds: (doc) => at(doc, "title") === "Page*",
        },
        {
          id: "p2",
          author: "alice",
          intent: 'rename "C" to "C*"',
          ops: [{ op: "replace", path: ["items", "2", "title"], value: "C*" }],
          holds: (doc) => hasTitle(doc, "C*") && !hasTitle(doc, "C"),
        },
      ],
    });
    expect(problems).toEqual([]);
    expect(report).toMatchSnapshot();
  });

  test("separate record keys: both authors publish alone", () => {
    // Records are keyed, not indexed, so `PatchSets` is precise about them. This
    // is also the sibling-prefix case: "foo" is a string prefix of "foobar", so
    // a patch set path comparison that ignores segment boundaries would wrongly
    // merge these two and force the authors to publish together.
    const projects = s.record(s.object({ title: s.string() }));
    const { report, problems } = runScenario({
      name: 'Bob edits record key "foo", Alice edits record key "foobar"',
      moduleFilePath: "/content/projects.val.ts",
      schema: projects,
      base: { foo: { title: "Foo" }, foobar: { title: "Foobar" } },
      render: (doc) => JSON.stringify(doc),
      independent: [["p1", "p2"]],
      patches: [
        {
          id: "p1",
          author: "bob",
          intent: 'retitle "foo"',
          ops: [{ op: "replace", path: ["foo", "title"], value: "Foo*" }],
          holds: (doc) => at(at(doc, "foo"), "title") === "Foo*",
        },
        {
          id: "p2",
          author: "alice",
          intent: 'retitle "foobar"',
          ops: [{ op: "replace", path: ["foobar", "title"], value: "Foobar*" }],
          holds: (doc) => at(at(doc, "foobar"), "title") === "Foobar*",
        },
      ],
    });
    expect(problems).toEqual([]);
    expect(report).toMatchSnapshot();
  });
  test('sibling record keys where one name is a prefix of the other ("foo" / "foobar")', () => {
    // The previous scenario does not reach the interesting case: both patch set
    // paths there end in `/title`, so a raw string prefix comparison happens to
    // say no. Here Bob *removes* the key, which makes his patch set path the bare
    // key `?foo` — and "foobar/title" does start with "foo".
    //
    // These two edits are completely unrelated: Alice retitling "foobar" must not
    // publish Bob's deletion of "foo".
    const projects = s.record(s.object({ title: s.string() }));
    const { report, problems } = runScenario({
      name: 'Bob removes record key "foo", Alice retitles record key "foobar"',
      moduleFilePath: "/content/projects.val.ts",
      schema: projects,
      base: { foo: { title: "Foo" }, foobar: { title: "Foobar" } },
      render: (doc) => JSON.stringify(doc),
      independent: [["p1", "p2"]],
      patches: [
        {
          id: "p1",
          author: "bob",
          intent: 'delete "foo"',
          ops: [{ op: "remove", path: ["foo"] }],
          holds: (doc) => at(doc, "foo") === undefined,
        },
        {
          id: "p2",
          author: "alice",
          intent: 'retitle "foobar"',
          ops: [{ op: "replace", path: ["foobar", "title"], value: "Foobar*" }],
          holds: (doc) => at(at(doc, "foobar"), "title") === "Foobar*",
        },
      ],
    });
    expect(problems).toEqual([]);
    expect(report).toMatchSnapshot();
  });
  // #endregion

  // #region the retroactive merge
  test("a third author's array insert merges two patch sets and repairs both groups", () => {
    // Bob and Alice edit different items, so at first they are in separate patch
    // sets and independent. Then Carol inserts into the array, which broadens the
    // patch set path to the whole array and merges both of theirs into it. Alice's
    // group was valid when she made it and is now a hole — without her touching
    // anything.
    const { report, problems } = runScenario({
      name: "Bob edits item 0, Alice edits item 1, then Carol inserts",
      moduleFilePath: "/content/page.val.ts",
      schema: page,
      base: threeItems,
      render: renderTitles,
      patches: [
        {
          id: "p1",
          author: "bob",
          intent: 'rename "A" to "A*"',
          ops: [{ op: "replace", path: ["items", "0", "title"], value: "A*" }],
          holds: (doc) => hasTitle(doc, "A*") && !hasTitle(doc, "A"),
        },
        {
          id: "p2",
          author: "alice",
          intent: 'rename "B" to "B*"',
          ops: [{ op: "replace", path: ["items", "1", "title"], value: "B*" }],
          holds: (doc) => hasTitle(doc, "B*") && !hasTitle(doc, "B"),
        },
        {
          id: "p3",
          author: "carol",
          intent: 'append "D"',
          ops: [{ op: "add", path: ["items", "3"], value: { title: "D" } }],
          holds: (doc) => hasTitle(doc, "D"),
        },
      ],
    });
    expect(problems).toEqual([]);
    expect(report).toMatchSnapshot();
  });
  // #endregion

  // #region same field
  test("two authors edit the same field: the later one carries the earlier", () => {
    const { report, problems } = runScenario({
      name: "Bob and Alice both retitle the page",
      moduleFilePath: "/content/page.val.ts",
      schema: page,
      base: threeItems,
      render: renderTitles,
      patches: [
        {
          id: "p1",
          author: "bob",
          intent: 'set the page title to "Bob was here"',
          ops: [{ op: "replace", path: ["title"], value: "Bob was here" }],
          // Bob's intent does NOT survive Alice's later edit to the same field.
          // That is a last-write-wins field, not a bug — but it is exactly the
          // kind of thing worth seeing in the trace rather than discovering in
          // production, so the predicate states what he can still expect.
          holds: (doc) => typeof at(doc, "title") === "string",
        },
        {
          id: "p2",
          author: "alice",
          intent: 'set the page title to "Alice was here"',
          ops: [{ op: "replace", path: ["title"], value: "Alice was here" }],
          holds: (doc) => at(doc, "title") === "Alice was here",
        },
      ],
    });
    expect(problems).toEqual([]);
    expect(report).toMatchSnapshot();
  });
  // #endregion

  // #region array remove
  test("remove then edit a later item in the same array", () => {
    const { report, problems } = runScenario({
      name: "Bob removes item 0, then Alice renames what is now item 0",
      moduleFilePath: "/content/page.val.ts",
      schema: page,
      base: threeItems,
      render: renderTitles,
      patches: [
        {
          id: "p1",
          author: "bob",
          intent: 'remove "A"',
          ops: [{ op: "remove", path: ["items", "0"] }],
          holds: (doc) => !hasTitle(doc, "A"),
        },
        {
          // Bob's removal is in Alice's group, so her view is [B, C] and the item
          // she means is at index 0.
          id: "p2",
          author: "alice",
          intent: 'rename "B" to "B*"',
          ops: [{ op: "replace", path: ["items", "0", "title"], value: "B*" }],
          holds: (doc) => hasTitle(doc, "B*") && !hasTitle(doc, "B"),
        },
      ],
    });
    expect(problems).toEqual([]);
    expect(report).toMatchSnapshot();
  });
  // #endregion
});

// #region helpers
// Deliberately assertion-free readers, so a malformed document shows up as a
// failing predicate rather than as a thrown TypeError inside a `holds` callback.

function at(doc: JSONValue | undefined, key: string): JSONValue | undefined {
  if (doc !== null && typeof doc === "object" && !Array.isArray(doc)) {
    return doc[key];
  }
  return undefined;
}

function titles(doc: JSONValue): string[] {
  const items = at(doc, "items");
  if (!Array.isArray(items)) {
    return [];
  }
  return items.map((item) => {
    const title = at(item, "title");
    return typeof title === "string" ? title : "<no title>";
  });
}

function hasTitle(doc: JSONValue, title: string): boolean {
  return titles(doc).includes(title);
}

function renderTitles(doc: JSONValue): string {
  const pageTitle = at(doc, "title");
  return `${typeof pageTitle === "string" ? pageTitle : "?"} [${titles(
    doc,
  ).join(", ")}]`;
}

// #endregion
