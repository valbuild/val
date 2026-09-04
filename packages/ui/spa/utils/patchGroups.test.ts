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
 * Each test scripts a sequence of steps — someone edits, stages, unstages,
 * publishes — and snapshots a trace. **The snapshot is the deliverable.** Read
 * `__snapshots__/patchGroups.test.ts.snap` alongside this file: it shows, after
 * every step, what each author picked their path in, what their group holds, what
 * they see, and which regions they are holding back.
 *
 * Next to each snapshot are the hard assertions:
 *
 * - `problems` is empty — no group breaks the prefix invariant, no group fails to
 *   apply, no author's stated intent stops being true in their own view, nothing
 *   declared independent turns out entangled.
 * - `blocked` lists edits the guard refused. Refusing is a correct outcome, so it
 *   is asserted separately rather than treated as a failure.
 *
 * ## The model
 *
 * 1. **A group holds its owner's patches, closed over their patch sets** — not
 *    every pending patch. This is not an arbitrary choice in either direction: the
 *    first describe below has the executable counterexample that rules out an empty
 *    group, and the reason the closure over patch sets is exactly what that
 *    counterexample demands, no more.
 * 2. **Patches in other patch sets stay out.** They cannot shift your paths, so
 *    they cannot corrupt your op — and keeping them out is what lets you publish
 *    alone without unstaging anything.
 * 3. **Unstaging carves out what the closure did pull in.** Drop a patch set from
 *    your group and it leaves your view and your publish.
 * 4. **A region you deliberately carved out is read-only for you** until you
 *    re-stage, because inside it your view and the published result disagree. A
 *    region you simply never had is staged for you before your op is resolved.
 *
 * Ops are resolved against the author's own view at pick time. Where a path
 * depends on position, the scenario computes it with a function — hand-writing an
 * index would assume a view the author may not have, which is the whole class of
 * bug this file exists to catch.
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

/** Rename the item currently titled `from`, wherever the author sees it. */
const renameItem = (from: string, to: string) => (view: JSONValue) => {
  const index = titles(view).indexOf(from);
  return [
    {
      op: "replace" as const,
      path: ["items", String(index), "title"],
      value: to,
    },
  ];
};

describe("patch groups", () => {
  // #region why the default is everything
  describe("why a group is its author's closure over their patch sets", () => {
    test("a path is picked before the closure runs, so the closure must cover the patch set", () => {
      // The counterexample that decides the model, and the reason the closure has
      // to run BEFORE the op path is resolved rather than after.
      //
      // Bob picks the index of "B" in his own view. Alice's insert is not his, so
      // his group does not hold it — but it is in the same patch set (?items), and
      // that is precisely the set of patches that can shift his paths. If he picked
      // against a view without it he would see [A, B, C], pick index 1, and then
      // creating his patch would close his group over her insert: index 1 becomes
      // "A" and he has silently renamed the wrong element. Staging later cannot fix
      // a path chosen earlier.
      //
      // So the edit stages her patch set first ("bob edits into a section held by
      // p1"), and only then resolves his op — against [New, A, B, C], where he picks
      // index 2. Read `picked in` in the trace: that line is the guarantee.
      const { report, problems, blocked } = runScenario({
        name: "Alice inserts at the top, then Bob renames the item he can see",
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
            edit: "p2",
            by: "bob",
            intent: 'rename "B" to "B*"',
            ops: renameItem("B", "B*"),
            holds: (doc) => hasTitle(doc, "B*") && !hasTitle(doc, "B"),
          },
        ],
      });
      expect(problems).toEqual([]);
      expect(blocked).toEqual([]);
      expect(report).toMatchSnapshot();
    });

    test("unrelated patch sets publish independently with nobody unstaging", () => {
      // The counterpart, and the payoff. Bob's ?title and Alice's ?items/2/title
      // are different patch sets, so neither can shift the other's paths and
      // neither group pulls the other in. Both publish alone without anybody
      // touching a staging control — independence is the default here, not
      // something you have to opt into by unstaging.
      const { report, problems, blocked } = runScenario({
        name: "Two authors edit unrelated things and neither unstages",
        moduleFilePath: "/content/page.val.ts",
        schema: page,
        shape: pageShape,
        base: threeItems,
        render: renderPage,
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
            ops: renameItem("C", "C*"),
            holds: (doc) => hasTitle(doc, "C*") && !hasTitle(doc, "C"),
          },
        ],
      });
      expect(problems).toEqual([]);
      expect(blocked).toEqual([]);
      expect(report).toMatchSnapshot();
    });
  });
  // #endregion

  // #region independence via unstaging
  describe("unstaging is what buys independence", () => {
    test("publish just the page title, leaving another author's array work behind", () => {
      // The headline use case: Alice wants her one-line title fix live without
      // shipping Bob's half-finished list. Different patch sets, so she can drop his
      // and publish hers alone. Bob's work survives the commit untouched.
      const { report, problems, blocked } = runScenario({
        name: "Bob is mid-way through the list; Alice ships a title fix",
        moduleFilePath: "/content/page.val.ts",
        schema: page,
        shape: pageShape,
        base: threeItems,
        render: renderPage,
        steps: [
          {
            edit: "p1",
            by: "bob",
            intent: 'insert "Draft" at the top',
            ops: [
              { op: "add", path: ["items", "0"], value: { title: "Draft" } },
            ],
            holds: (doc) => hasTitle(doc, "Draft"),
          },
          {
            edit: "p2",
            by: "alice",
            intent: "retitle the page",
            ops: [{ op: "replace", path: ["title"], value: "Page*" }],
            holds: (doc) => at(doc, "title") === "Page*",
          },
          { unstage: ["p1"], by: "alice" },
          { publish: "alice" },
        ],
      });
      expect(problems).toEqual([]);
      expect(blocked).toEqual([]);
      expect(report).toMatchSnapshot();
    });

    test("Bob can carry on and publish after Alice's commit", () => {
      // The other half of the same story: Bob's patch outlived the commit, still
      // applies on the new base, and still means what he meant.
      const { report, problems, blocked } = runScenario({
        name: "Alice ships a title fix, then Bob finishes and ships the list",
        moduleFilePath: "/content/page.val.ts",
        schema: page,
        shape: pageShape,
        base: threeItems,
        render: renderPage,
        steps: [
          {
            edit: "p1",
            by: "bob",
            intent: 'insert "Draft" at the top',
            ops: [
              { op: "add", path: ["items", "0"], value: { title: "Draft" } },
            ],
            holds: (doc) => hasTitle(doc, "Draft"),
          },
          {
            edit: "p2",
            by: "alice",
            intent: "retitle the page",
            ops: [{ op: "replace", path: ["title"], value: "Page*" }],
            holds: (doc) => at(doc, "title") === "Page*",
          },
          { unstage: ["p1"], by: "alice" },
          { publish: "alice" },
          {
            edit: "p3",
            by: "bob",
            intent: 'rename "C" to "C*"',
            ops: renameItem("C", "C*"),
            holds: (doc) => hasTitle(doc, "C*") && !hasTitle(doc, "C"),
          },
          { publish: "bob" },
        ],
      });
      expect(problems).toEqual([]);
      expect(blocked).toEqual([]);
      expect(report).toMatchSnapshot();
    });

    test("unstaging drops what was built on top of it, but not what came before", () => {
      // Forward closure only. Alice unstages Bob's insert; her own later edit to the
      // same array goes too, because its index only means what she meant while that
      // insert is applied. Her *earlier*, unrelated title edit stays.
      const { report, problems, blocked } = runScenario({
        name: "Alice unstages an insert her own later edit depends on",
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
            by: "bob",
            intent: 'insert "Draft" at the top',
            ops: [
              { op: "add", path: ["items", "0"], value: { title: "Draft" } },
            ],
            holds: (doc) => hasTitle(doc, "Draft"),
          },
          {
            edit: "p3",
            by: "alice",
            intent: 'rename "C" to "C*"',
            ops: renameItem("C", "C*"),
            holds: (doc) => hasTitle(doc, "C*") && !hasTitle(doc, "C"),
          },
          { unstage: ["p2"], by: "alice" },
          { publish: "alice" },
        ],
      });
      expect(problems).toEqual([]);
      expect(blocked).toEqual([]);
      expect(report).toMatchSnapshot();
    });

    test("re-staging restores the region and the view", () => {
      const { report, problems, blocked } = runScenario({
        name: "Alice unstages Bob's insert and then changes her mind",
        moduleFilePath: "/content/page.val.ts",
        schema: page,
        shape: pageShape,
        base: threeItems,
        render: renderPage,
        steps: [
          {
            edit: "p1",
            by: "bob",
            intent: 'insert "Draft" at the top',
            ops: [
              { op: "add", path: ["items", "0"], value: { title: "Draft" } },
            ],
            holds: (doc) => hasTitle(doc, "Draft"),
          },
          { unstage: ["p1"], by: "alice" },
          { stage: ["p1"], by: "alice" },
          {
            edit: "p2",
            by: "alice",
            intent: 'rename "B" to "B*"',
            ops: renameItem("B", "B*"),
            holds: (doc) => hasTitle(doc, "B*") && !hasTitle(doc, "B"),
          },
          { publish: "alice" },
        ],
      });
      expect(problems).toEqual([]);
      expect(blocked).toEqual([]);
      expect(report).toMatchSnapshot();
    });
  });
  // #endregion

  // #region the guard
  describe("a region you have unstaged is read-only until you re-stage", () => {
    test("editing a held region is refused rather than silently corrupted", () => {
      // Without the guard: Alice's view is [A, B, C], she picks index 1 for "B",
      // creating the patch re-stages Bob's insert, index 1 becomes "A", and she has
      // renamed the wrong element — cleanly, invariant intact, only the content
      // wrong.
      //
      // With the guard: refused, because inside `?items` her view and the published
      // result disagree. The next test is the way out.
      const { report, problems, blocked } = runScenario({
        name: "Alice unstages Bob's insert, then tries to edit that array",
        moduleFilePath: "/content/page.val.ts",
        schema: page,
        shape: pageShape,
        base: threeItems,
        render: renderPage,
        steps: [
          {
            edit: "p1",
            by: "bob",
            intent: 'insert "Draft" at the top',
            ops: [
              { op: "add", path: ["items", "0"], value: { title: "Draft" } },
            ],
            holds: (doc) => hasTitle(doc, "Draft"),
          },
          { unstage: ["p1"], by: "alice" },
          {
            edit: "p2",
            by: "alice",
            intent: 'rename "B" to "B*"',
            ops: renameItem("B", "B*"),
            holds: (doc) => hasTitle(doc, "B*") && !hasTitle(doc, "B"),
          },
        ],
      });
      expect(blocked).toEqual(["p2"]);
      expect(problems).toEqual([]);
      expect(report).toMatchSnapshot();
    });

    test("holding one region does not block edits in another", () => {
      // The guard has to be narrow enough to be usable. If holding `?items` ever
      // starts blocking a page-title edit, the guard has become an
      // over-approximation that makes unstaging pointless.
      const { report, problems, blocked } = runScenario({
        name: "Alice holds Bob's array work but edits the page title",
        moduleFilePath: "/content/page.val.ts",
        schema: page,
        shape: pageShape,
        base: threeItems,
        render: renderPage,
        steps: [
          {
            edit: "p1",
            by: "bob",
            intent: 'insert "Draft" at the top',
            ops: [
              { op: "add", path: ["items", "0"], value: { title: "Draft" } },
            ],
            holds: (doc) => hasTitle(doc, "Draft"),
          },
          { unstage: ["p1"], by: "alice" },
          {
            edit: "p2",
            by: "alice",
            intent: "retitle the page",
            ops: [{ op: "replace", path: ["title"], value: "Page*" }],
            holds: (doc) => at(doc, "title") === "Page*",
          },
          { publish: "alice" },
        ],
      });
      expect(problems).toEqual([]);
      expect(blocked).toEqual([]);
      expect(report).toMatchSnapshot();
    });

    test("a new patch does not join a group that is holding its region", () => {
      // Bob keeps working in the array Alice has held. His new patch must stay out
      // of her group, or her hold would silently leak back.
      const { report, problems, blocked } = runScenario({
        name: "Alice holds the array; Bob adds more to it",
        moduleFilePath: "/content/page.val.ts",
        schema: page,
        shape: pageShape,
        base: threeItems,
        render: renderPage,
        steps: [
          {
            edit: "p1",
            by: "bob",
            intent: 'insert "Draft" at the top',
            ops: [
              { op: "add", path: ["items", "0"], value: { title: "Draft" } },
            ],
            holds: (doc) => hasTitle(doc, "Draft"),
          },
          { unstage: ["p1"], by: "alice" },
          {
            edit: "p2",
            by: "bob",
            intent: 'append "Extra"',
            ops: (view) => [
              {
                op: "add",
                path: ["items", String(titles(view).length)],
                value: { title: "Extra" },
              },
            ],
            holds: (doc) => hasTitle(doc, "Extra"),
          },
        ],
      });
      expect(problems).toEqual([]);
      expect(blocked).toEqual([]);
      expect(report).toMatchSnapshot();
    });
  });
  // #endregion

  // #region patch set integrity
  describe("patch sets stay sensible", () => {
    test("independent record keys stay in separate patch sets", () => {
      const { report, problems, blocked } = runScenario({
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
      expect(blocked).toEqual([]);
      expect(report).toMatchSnapshot();
    });

    test("sibling record keys where one name is a prefix of the other", () => {
      // Regression test. A patch set is keyed `<module>?<path joined by "/">` and
      // nothing terminates a path segment, so a raw `startsWith` made
      // "?foobar/title" match "?foo". Deleting key "foo" and retitling key "foobar"
      // were merged into one patch set — so staging "foobar" would have silently
      // published the deletion of "foo".
      //
      // Bob *removes* the key here, which is what makes his patch set path the bare
      // key "?foo". Two replaces do not reach the bug, because both paths then end
      // in "/title".
      const { report, problems, blocked } = runScenario({
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
      expect(blocked).toEqual([]);
      expect(report).toMatchSnapshot();
    });

    test("a move belongs to two patch sets and entangles both", () => {
      // `PatchSets.insert` calls `insertPath` twice for a `move`: once for the
      // destination and once for `op.from`. So one patch is in two patch sets and
      // the closure has to reach a fixpoint rather than doing a single pass.
      const board = s.object({
        todo: s.array(s.object({ title: s.string() })),
        done: s.array(s.object({ title: s.string() })),
      });
      const { report, problems, blocked } = runScenario({
        name: "Alice moves an item between two arrays other people have edited",
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
            edit: "p3",
            by: "alice",
            intent: 'move "T2" from todo to done',
            ops: (view) => [
              {
                op: "move",
                from: ["todo", String(listTitles(view, "todo").indexOf("T2"))],
                path: ["done", String(listTitles(view, "done").length)],
              },
            ],
            holds: (doc) =>
              listTitles(doc, "done").includes("T2") &&
              !listTitles(doc, "todo").includes("T2"),
          },
        ],
      });
      expect(problems).toEqual([]);
      expect(blocked).toEqual([]);
      expect(report).toMatchSnapshot();
    });

    test("last write wins on a shared scalar field", () => {
      const { report, problems, blocked } = runScenario({
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
            // field. That is last-write-wins on a scalar, not a bug, so his
            // predicate states what he can still legitimately expect. Asserting
            // `=== "Bob was here"` would assert a guarantee the design does not make.
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
      expect(blocked).toEqual([]);
      expect(report).toMatchSnapshot();
    });
  });
  // #endregion

  // #region a group is only ever grown by its owner
  describe("a merge that invalidates a group leaves it alone", () => {
    /*
     * The one path to a group that breaks the prefix invariant without its
     * owner doing anything wrong.
     *
     * Alice holds Bob's rename of item 0 — a leaf patch set, so it does not
     * stop her editing item 1, which is a different patch set. Then Carol
     * appends to the array. An array op keys on the parent, so `?items`
     * swallows both leaves and becomes [p1, p2, p3]. Alice's group has p2 but
     * not p1: a hole she never made.
     *
     * A group grows when its owner writes, and at no other time. So nothing
     * repairs this. `publish` refuses her group and names what is missing, and
     * she decides — stage Bob's rename, or unstage her own edit.
     *
     * Both automatic repairs were rejected, and each for its own reason.
     * `extend` restored the prefix by pulling p1 in, which publishes work Alice
     * had deliberately excluded, without asking. `truncate` honoured the
     * exclusion by dropping p2 instead — leaving a perfectly valid group, so no
     * assertion fired and the only trace of Alice losing her edit was her group
     * quietly going empty. Both decide, silently, the one thing only she can.
     */
    const mergeScenario = (): Scenario => ({
      name: "Alice holds item 0 and edits item 1, then Carol's append merges both",
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
          ops: renameItem("A", "A*"),
          holds: (doc) => hasTitle(doc, "A*") && !hasTitle(doc, "A"),
        },
        { unstage: ["p1"], by: "alice" },
        {
          // Allowed: `?items/1/title` is not inside the held `?items/0/title`,
          // and a replace does not shift indices, so Alice's path stays
          // meaningful.
          edit: "p2",
          by: "alice",
          intent: 'rename "B" to "B*"',
          ops: renameItem("B", "B*"),
          holds: (doc) => hasTitle(doc, "B*") && !hasTitle(doc, "B"),
        },
        {
          edit: "p3",
          by: "carol",
          intent: 'append "D"',
          ops: (view) => [
            {
              op: "add",
              path: ["items", String(titles(view).length)],
              value: { title: "D" },
            },
          ],
          holds: (doc) => hasTitle(doc, "D"),
        },
      ],
    });

    test("the hole is reported, not filled, and Alice keeps her own edit", () => {
      const { report, problems } = runScenario(mergeScenario());
      /*
       * The hole is REAL and it stays. `problems` is the harness's own
       * invariant check, run independently of the trace, and here it is the
       * assertion rather than a failure: under this policy an invalidated group
       * is a state the system is allowed to be in, and `publish` is what
       * refuses it.
       */
      expect(problems).toEqual([
        "step 4: alice's group breaks the prefix invariant in patch set /content/page.val.ts?items: staged [p2] but missing [p1]",
      ]);
      // Named, so it is actionable rather than a silent refusal later.
      expect(report).toContain("alice's group now has a hole: needs p1");
      // Not widened: Bob's rename did not join her group.
      expect(report).not.toContain("alice's group +p1");
      // Not truncated either: her own edit is still hers to publish.
      expect(report).not.toContain("alice's group -p2");
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
