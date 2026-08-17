import { initVal } from "@valbuild/core";
import { JSONValue } from "@valbuild/core/patch";
import { runScenario, Scenario } from "./patchGroupScenario";

const { s } = initVal();

/**
 * Scenarios for staging and unstaging patches. See
 * `docs/independent-publish/PLAN.md`.
 *
 * ## How to read this file
 *
 * Each test scripts a sequence of steps — someone edits, someone stages,
 * unstages, publishes — and snapshots a trace of what happened. **The snapshot is
 * the point.** Read `__snapshots__/patchGroups.test.ts.snap` alongside this file;
 * it shows, after every step, each author's group and what each author sees.
 *
 * Next to each snapshot is `expect(problems).toEqual([])`. That is the hard part:
 * it fails if a group breaks the prefix invariant, if a group will not apply, if
 * an author's stated intent stops being true in their own view, or if two changes
 * declared independent turn out to be entangled.
 *
 * ## What is settled and what is not
 *
 * Settled: staged is the truth; the prefix invariant is the rule; patches outlive
 * commits.
 *
 * **Not settled — these tests exist to decide it:**
 *
 * - DECISION 1 — array co-editing. Once two authors have both edited the same
 *   array and the first comes back to it, neither can publish without the other.
 *   Acceptable, or do arrays need finer patch sets?
 * - DECISION 2 — repair policy. When a patch-set merge invalidates a group,
 *   `extend` publishes work the user did not choose and `truncate` silently drops
 *   the user's own. The same scenario runs under both so the traces can be
 *   compared.
 * - DECISION 3 — unstaging. It cascades forwards, and it is not sticky: editing
 *   the same region pulls an unstaged change straight back in.
 */

const page = s.object({
  title: s.string(),
  items: s.array(s.object({ title: s.string() })),
});
const pageShape = "{ title, items: [{ title }] }";
const threeItems: JSONValue = {
  title: "Page",
  items: [{ title: "A" }, { title: "B" }, { title: "C" }],
};

const projects = s.record(s.object({ title: s.string() }));

describe("patch groups", () => {
  // #region what the feature is for
  describe("independent changes publish independently", () => {
    test("different fields of the same object", () => {
      const { report, problems } = runScenario({
        name: "Bob edits the page title, Alice edits an item title",
        moduleFilePath: "/content/page.val.ts",
        schema: page,
        shape: pageShape,
        base: threeItems,
        render: renderPage,
        independent: [["p1", "p2"]],
        steps: [
          {
            edit: "p1",
            by: "bob",
            intent: "retitle the page",
            ops: [{ op: "replace", path: ["title"], value: "Page*" }],
            holds: (doc) => at(doc, "title") === "Page*",
          },
          {
            edit: "p2",
            by: "alice",
            intent: 'rename "C" to "C*"',
            ops: [
              { op: "replace", path: ["items", "2", "title"], value: "C*" },
            ],
            holds: (doc) => hasTitle(doc, "C*") && !hasTitle(doc, "C"),
          },
        ],
      });
      expect(problems).toEqual([]);
      expect(report).toMatchSnapshot();
    });

    test("different record keys", () => {
      const { report, problems } = runScenario({
        name: 'Bob retitles record key "foo", Alice retitles "bar"',
        moduleFilePath: "/content/projects.val.ts",
        schema: projects,
        shape: "record of { title }",
        base: { foo: { title: "Foo" }, bar: { title: "Bar" } },
        render: renderRecord,
        independent: [["p1", "p2"]],
        steps: [
          {
            edit: "p1",
            by: "bob",
            intent: 'retitle "foo"',
            ops: [{ op: "replace", path: ["foo", "title"], value: "Foo*" }],
            holds: (doc) => at(at(doc, "foo"), "title") === "Foo*",
          },
          {
            edit: "p2",
            by: "alice",
            intent: 'retitle "bar"',
            ops: [{ op: "replace", path: ["bar", "title"], value: "Bar*" }],
            holds: (doc) => at(at(doc, "bar"), "title") === "Bar*",
          },
        ],
      });
      expect(problems).toEqual([]);
      expect(report).toMatchSnapshot();
    });

    test("sibling record keys where one name is a prefix of the other", () => {
      // Regression test. `PatchSets` keys a patch set by
      // `<module>?<path joined by "/">`, and nothing terminates a path segment, so
      // a raw `startsWith` made "?foobar/title" match "?foo". Deleting key "foo"
      // and retitling key "foobar" were merged into one patch set — meaning
      // staging "foobar" would have silently published the deletion of "foo".
      //
      // Bob *removes* the key here, which is what makes his patch set path the
      // bare key "?foo". The equivalent scenario with two replaces does not reach
      // the bug, because both paths then end in "/title".
      const { report, problems } = runScenario({
        name: 'Bob deletes record key "foo", Alice retitles "foobar"',
        moduleFilePath: "/content/projects.val.ts",
        schema: projects,
        shape: "record of { title }",
        base: { foo: { title: "Foo" }, foobar: { title: "Foobar" } },
        render: renderRecord,
        independent: [["p1", "p2"]],
        steps: [
          {
            edit: "p1",
            by: "bob",
            intent: 'delete "foo"',
            ops: [{ op: "remove", path: ["foo"] }],
            holds: (doc) => at(doc, "foo") === undefined,
          },
          {
            edit: "p2",
            by: "alice",
            intent: 'retitle "foobar"',
            ops: [
              { op: "replace", path: ["foobar", "title"], value: "Foobar*" },
            ],
            holds: (doc) => at(at(doc, "foobar"), "title") === "Foobar*",
          },
        ],
      });
      expect(problems).toEqual([]);
      expect(report).toMatchSnapshot();
    });
  });
  // #endregion

  // #region the ordering asymmetry
  describe("who carries whom depends on the order", () => {
    test("edit, then insert above it: the inserter carries the editor", () => {
      const { report, problems } = runScenario({
        name: "Bob renames an item, then Alice inserts above it",
        moduleFilePath: "/content/page.val.ts",
        schema: page,
        shape: pageShape,
        base: threeItems,
        render: renderPage,
        steps: [
          {
            edit: "p1",
            by: "bob",
            intent: 'rename "B" to "B*"',
            ops: [
              { op: "replace", path: ["items", "1", "title"], value: "B*" },
            ],
            holds: (doc) => hasTitle(doc, "B*") && !hasTitle(doc, "B"),
          },
          {
            edit: "p2",
            by: "alice",
            intent: 'insert "New" at the top',
            ops: [{ op: "add", path: ["items", "0"], value: { title: "New" } }],
            holds: (doc) => titles(doc)[0] === "New",
          },
        ],
      });
      expect(problems).toEqual([]);
      expect(report).toMatchSnapshot();
    });

    test("insert, then edit below it: the editor carries the inserter", () => {
      const { report, problems } = runScenario({
        name: "Alice inserts at the top, then Bob renames an item",
        moduleFilePath: "/content/page.val.ts",
        schema: page,
        shape: pageShape,
        base: threeItems,
        render: renderPage,
        steps: [
          {
            edit: "p1",
            by: "alice",
            intent: 'insert "New" at the top',
            ops: [{ op: "add", path: ["items", "0"], value: { title: "New" } }],
            holds: (doc) => titles(doc)[0] === "New",
          },
          {
            // Bob was forced to stage p1, so his view is [New, A, B, C] and "B"
            // is at index 2. That is why his index is 2 and not 1 — and it is why
            // his patch still means the right thing after Alice publishes.
            edit: "p2",
            by: "bob",
            intent: 'rename "B" to "B*"',
            ops: [
              { op: "replace", path: ["items", "2", "title"], value: "B*" },
            ],
            holds: (doc) => hasTitle(doc, "B*") && !hasTitle(doc, "B"),
          },
        ],
      });
      expect(problems).toEqual([]);
      expect(report).toMatchSnapshot();
    });

    test("publish then continue: the other author's remaining work still applies", () => {
      const { report, problems } = runScenario({
        name: "Bob renames, Alice inserts, Bob publishes, Alice carries on",
        moduleFilePath: "/content/page.val.ts",
        schema: page,
        shape: pageShape,
        base: threeItems,
        render: renderPage,
        steps: [
          {
            edit: "p1",
            by: "bob",
            intent: 'rename "B" to "B*"',
            ops: [
              { op: "replace", path: ["items", "1", "title"], value: "B*" },
            ],
            holds: (doc) => hasTitle(doc, "B*") && !hasTitle(doc, "B"),
          },
          {
            edit: "p2",
            by: "alice",
            intent: 'insert "New" at the top',
            ops: [{ op: "add", path: ["items", "0"], value: { title: "New" } }],
            holds: (doc) => titles(doc)[0] === "New",
          },
          { publish: "bob" },
          {
            // Alice keeps working after Bob's commit. Her earlier p2 is still
            // pending and must still mean what she meant.
            edit: "p3",
            by: "alice",
            intent: 'rename "C" to "C*"',
            ops: [
              { op: "replace", path: ["items", "3", "title"], value: "C*" },
            ],
            holds: (doc) => hasTitle(doc, "C*") && !hasTitle(doc, "C"),
          },
          { publish: "alice" },
        ],
      });
      expect(problems).toEqual([]);
      expect(report).toMatchSnapshot();
    });
  });
  // #endregion

  // #region DECISION 1
  describe("DECISION 1 — array co-editing entangles both authors", () => {
    test("once the first author returns to a shared array, neither can publish alone", () => {
      // This is the case the prefix rule does NOT get us out of, and it deserves
      // an explicit decision.
      //
      // p1 bob, p2 alice, p3 bob — all on the same array, so all one patch set.
      // After p2 the groups are nested: bob {p1}, alice {p1,p2}, and bob can still
      // publish alone. After p3, bob's group closes over p2, so bob has {p1,p2,p3}
      // and alice has {p1,p2}. Now *both* groups contain *both* authors' work and
      // neither can ship without the other.
      //
      // So concurrent editing of one array degrades to "you are in this together"
      // as soon as anybody makes a second edit. Accepting that means arrays are
      // effectively single-writer for independent publishing. Rejecting it means
      // patch sets have to be finer than "the whole array", which the existing code
      // explicitly declined to do ("would need a lot of logic").
      const { report, problems } = runScenario({
        name: "Bob edits the array, Alice edits it, then Bob edits it again",
        moduleFilePath: "/content/page.val.ts",
        schema: page,
        shape: pageShape,
        base: threeItems,
        render: renderPage,
        steps: [
          {
            edit: "p1",
            by: "bob",
            intent: 'rename "A" to "A*"',
            ops: [
              { op: "replace", path: ["items", "0", "title"], value: "A*" },
            ],
            holds: (doc) => hasTitle(doc, "A*") && !hasTitle(doc, "A"),
          },
          {
            edit: "p2",
            by: "alice",
            intent: 'append "D"',
            ops: [{ op: "add", path: ["items", "3"], value: { title: "D" } }],
            holds: (doc) => hasTitle(doc, "D"),
          },
          {
            edit: "p3",
            by: "bob",
            intent: 'rename "C" to "C*"',
            ops: [
              { op: "replace", path: ["items", "2", "title"], value: "C*" },
            ],
            holds: (doc) => hasTitle(doc, "C*") && !hasTitle(doc, "C"),
          },
        ],
      });
      expect(problems).toEqual([]);
      expect(report).toMatchSnapshot();
    });
  });
  // #endregion

  // #region DECISION 2
  describe("DECISION 2 — repair policy when a merge invalidates a group", () => {
    // Bob and Alice edit different items, so they start in separate patch sets and
    // are genuinely independent. Then Carol's array insert broadens the patch set
    // path to the whole array and swallows both — and Alice's group, which nobody
    // touched, now has a hole in it.
    //
    // Compare the two snapshots. Under `extend` Alice's change stays publishable
    // but she now ships Bob's rename. Under `truncate` she ships nothing
    // unexpected, but her own rename has silently left her group — she would hit
    // Publish, get success, and not see her edit.
    const mergeScenario = (
      repairPolicy: Scenario["repairPolicy"],
    ): Scenario => ({
      name: `Bob edits item 0, Alice edits item 1, Carol inserts (repair: ${repairPolicy})`,
      moduleFilePath: "/content/page.val.ts",
      schema: page,
      shape: pageShape,
      base: threeItems,
      render: renderPage,
      repairPolicy,
      steps: [
        {
          edit: "p1",
          by: "bob",
          intent: 'rename "A" to "A*"',
          ops: [{ op: "replace", path: ["items", "0", "title"], value: "A*" }],
          holds: (doc) => hasTitle(doc, "A*") && !hasTitle(doc, "A"),
        },
        {
          edit: "p2",
          by: "alice",
          intent: 'rename "B" to "B*"',
          ops: [{ op: "replace", path: ["items", "1", "title"], value: "B*" }],
          holds: (doc) => hasTitle(doc, "B*") && !hasTitle(doc, "B"),
        },
        {
          edit: "p3",
          by: "carol",
          intent: 'append "D"',
          ops: [{ op: "add", path: ["items", "3"], value: { title: "D" } }],
          holds: (doc) => hasTitle(doc, "D"),
        },
      ],
    });

    test("extend: Alice keeps her change but now carries Bob's", () => {
      const { report, problems } = runScenario(mergeScenario("extend"));
      expect(problems).toEqual([]);
      expect(report).toMatchSnapshot();
    });

    test("truncate: Alice carries nobody, but loses her own change", () => {
      const { report, problems } = runScenario(mergeScenario("truncate"));
      // Truncate drops Alice's own patch out of her group. That is not an
      // invariant violation — the resulting group is still valid — so `problems`
      // stays empty and the cost shows up only in the trace. That asymmetry is
      // itself an argument for `extend`: truncate's bad outcome is invisible to
      // assertions and visible only to a user who notices their edit is missing.
      expect(problems).toEqual([]);
      expect(report).toMatchSnapshot();
    });
  });
  // #endregion

  // #region DECISION 3
  describe("DECISION 3 — unstaging", () => {
    test("unstaging a patch also unstages what was built on top of it", () => {
      const { report, problems } = runScenario({
        name: "Alice unstages Bob's insert that her own edit depends on",
        moduleFilePath: "/content/page.val.ts",
        schema: page,
        shape: pageShape,
        base: threeItems,
        render: renderPage,
        steps: [
          {
            edit: "p1",
            by: "bob",
            intent: 'insert "New" at the top',
            ops: [{ op: "add", path: ["items", "0"], value: { title: "New" } }],
            holds: (doc) => titles(doc)[0] === "New",
          },
          {
            edit: "p2",
            by: "alice",
            intent: 'rename "B" to "B*"',
            ops: [
              { op: "replace", path: ["items", "2", "title"], value: "B*" },
            ],
            holds: (doc) => hasTitle(doc, "B*") && !hasTitle(doc, "B"),
          },
          // Alice does not want to publish Bob's insert. Her own p2 has to go too:
          // its index 2 only means "B" while that insert is applied.
          { unstage: ["p1"], by: "alice" },
        ],
      });
      expect(problems).toEqual([]);
      expect(report).toMatchSnapshot();
    });

    test("KNOWN HOLE: unstage then edit the same region corrupts the edit", () => {
      // This is the sharpest thing the suite has found and it is NOT yet fixed.
      //
      // Alice unstages Bob's insert, so her view is back to [A, B, C] and "B" is
      // at index 1. She edits index 1. But the closure immediately re-stages Bob's
      // insert — her group must be prefix-closed — and now index 1 is "A". She
      // renamed the wrong element: [New, B*, B, C].
      //
      // Read the trace: at step 3 her group is {p1, p2} and her view has "B*"
      // where "A" used to be, with "B" still sitting there untouched. It applies
      // cleanly and the prefix invariant holds. Nothing is detectably wrong except
      // the content, which is why the harness checks intent rather than ids.
      //
      // Note this is *not* the same as the ordering asymmetry, where the closure
      // fires before the author picks a path so their index is computed against the
      // right view. Here the author picks a path against a view the closure is
      // about to invalidate.
      //
      // Options, none of them free:
      //  a) do not offer unstage for a patch set the author has pending edits in,
      //     and once they edit that region again, force an explicit re-stage;
      //  b) rebase the author's own pending ops when a re-stage shifts them;
      //  c) treat any edit into a patch set holding an unstaged patch as a conflict
      //     the author has to resolve by hand.
      //
      // Until one is chosen, the defect is asserted rather than hidden — the
      // expectation below changes when it is fixed, which is the point.
      const { report, problems } = runScenario({
        name: "Alice unstages Bob's insert, then edits the array anyway",
        moduleFilePath: "/content/page.val.ts",
        schema: page,
        shape: pageShape,
        base: threeItems,
        render: renderPage,
        steps: [
          {
            edit: "p1",
            by: "bob",
            intent: 'insert "New" at the top',
            ops: [{ op: "add", path: ["items", "0"], value: { title: "New" } }],
            holds: (doc) => titles(doc)[0] === "New",
          },
          { unstage: ["p1"], by: "alice" },
          {
            edit: "p2",
            by: "alice",
            intent: 'rename "B" to "B*"',
            // Index 1 is "B" in the view Alice can actually see when she picks it.
            ops: [
              { op: "replace", path: ["items", "1", "title"], value: "B*" },
            ],
            holds: (doc) => hasTitle(doc, "B*") && !hasTitle(doc, "B"),
          },
        ],
      });
      expect(problems).toEqual([
        'step 3: in alice\'s own view, p2 no longer achieves "rename "B" to "B*""',
      ]);
      expect(report).toMatchSnapshot();
    });

    test("unstaging in a different patch set leaves the rest of the group alone", () => {
      const { report, problems } = runScenario({
        name: "Alice unstages one of her two unrelated edits, then publishes",
        moduleFilePath: "/content/page.val.ts",
        schema: page,
        shape: pageShape,
        base: threeItems,
        render: renderPage,
        steps: [
          {
            edit: "p1",
            by: "alice",
            intent: "retitle the page",
            ops: [{ op: "replace", path: ["title"], value: "Page*" }],
            holds: (doc) => at(doc, "title") === "Page*",
          },
          {
            edit: "p2",
            by: "alice",
            intent: 'rename "C" to "C*"',
            ops: [
              { op: "replace", path: ["items", "2", "title"], value: "C*" },
            ],
            holds: (doc) => hasTitle(doc, "C*") && !hasTitle(doc, "C"),
          },
          { unstage: ["p1"], by: "alice" },
          { publish: "alice" },
        ],
      });
      expect(problems).toEqual([]);
      expect(report).toMatchSnapshot();
    });
  });
  // #endregion

  // #region one patch, two patch sets
  describe("a move belongs to two patch sets", () => {
    test("moving between two arrays entangles both", () => {
      // `PatchSets.insert` calls `insertPath` twice for a `move`: once for the
      // destination and once for `op.from`. So one patch is in two patch sets and
      // the closure has to reach a fixpoint rather than doing a single pass.
      const board = s.object({
        todo: s.array(s.object({ title: s.string() })),
        done: s.array(s.object({ title: s.string() })),
      });
      const { report, problems } = runScenario({
        name: "Bob edits todo, Carol edits done, Alice moves an item across",
        moduleFilePath: "/content/board.val.ts",
        schema: board,
        shape: "{ todo: [{ title }], done: [{ title }] }",
        base: {
          todo: [{ title: "T1" }, { title: "T2" }],
          done: [{ title: "D1" }],
        },
        render: (doc) =>
          `todo[${listTitles(doc, "todo").join(", ")}] done[${listTitles(
            doc,
            "done",
          ).join(", ")}]`,
        steps: [
          {
            edit: "p1",
            by: "bob",
            intent: 'rename "T1" to "T1*"',
            ops: [
              { op: "replace", path: ["todo", "0", "title"], value: "T1*" },
            ],
            holds: (doc) =>
              listTitles(doc, "todo").includes("T1*") &&
              !listTitles(doc, "todo").includes("T1"),
          },
          {
            edit: "p2",
            by: "carol",
            intent: 'rename "D1" to "D1*"',
            ops: [
              { op: "replace", path: ["done", "0", "title"], value: "D1*" },
            ],
            holds: (doc) =>
              listTitles(doc, "done").includes("D1*") &&
              !listTitles(doc, "done").includes("D1"),
          },
          {
            // One patch, two patch sets — so this pulls in both Bob's and Carol's.
            edit: "p3",
            by: "alice",
            intent: 'move "T2" from todo to done',
            ops: [{ op: "move", from: ["todo", "1"], path: ["done", "1"] }],
            holds: (doc) =>
              listTitles(doc, "done").includes("T2") &&
              !listTitles(doc, "todo").includes("T2"),
          },
        ],
      });
      expect(problems).toEqual([]);
      expect(report).toMatchSnapshot();
    });
  });
  // #endregion

  // #region last write wins
  describe("two authors edit the same scalar field", () => {
    test("the later edit wins and the earlier author's exact value does not survive", () => {
      const { report, problems } = runScenario({
        name: "Bob and Alice both retitle the page",
        moduleFilePath: "/content/page.val.ts",
        schema: page,
        shape: pageShape,
        base: threeItems,
        render: renderPage,
        steps: [
          {
            edit: "p1",
            by: "bob",
            intent: "have some page title of his own choosing",
            // Bob's specific value does not survive Alice's later edit to the same
            // field. That is last-write-wins on a scalar, not a bug — so his
            // predicate states what he can still legitimately expect. Asserting
            // `=== "Bob was here"` would be asserting a guarantee the design does
            // not make.
            ops: [{ op: "replace", path: ["title"], value: "Bob was here" }],
            holds: (doc) => typeof at(doc, "title") === "string",
          },
          {
            edit: "p2",
            by: "alice",
            intent: 'set the page title to "Alice was here"',
            ops: [{ op: "replace", path: ["title"], value: "Alice was here" }],
            holds: (doc) => at(doc, "title") === "Alice was here",
          },
        ],
      });
      expect(problems).toEqual([]);
      expect(report).toMatchSnapshot();
    });
  });
  // #endregion
});

// #region helpers
// Deliberately assertion-free readers, so a malformed document shows up as a
// failing predicate rather than a thrown TypeError inside a `holds` callback.

function at(doc: JSONValue | undefined, key: string): JSONValue | undefined {
  if (
    doc !== null &&
    doc !== undefined &&
    typeof doc === "object" &&
    !Array.isArray(doc)
  ) {
    return doc[key];
  }
  return undefined;
}

function listTitles(doc: JSONValue, key: string): string[] {
  const items = at(doc, key);
  if (!Array.isArray(items)) {
    return [];
  }
  return items.map((item) => {
    const title = at(item, "title");
    return typeof title === "string" ? title : "<no title>";
  });
}

function titles(doc: JSONValue): string[] {
  return listTitles(doc, "items");
}

function hasTitle(doc: JSONValue, title: string): boolean {
  return titles(doc).includes(title);
}

function renderPage(doc: JSONValue): string {
  const pageTitle = at(doc, "title");
  return `"${typeof pageTitle === "string" ? pageTitle : "?"}" [${titles(
    doc,
  ).join(", ")}]`;
}

function renderRecord(doc: JSONValue): string {
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
    return JSON.stringify(doc);
  }
  return `{${Object.keys(doc)
    .map((key) => {
      const title = at(doc[key], "title");
      return `${key}: ${typeof title === "string" ? title : "?"}`;
    })
    .join(", ")}}`;
}

// #endregion
