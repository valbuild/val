import {
  initVal,
  ModuleFilePath,
  PatchId,
  Schema,
  SelectorSource,
} from "@valbuild/core";
import { Patch } from "@valbuild/core/patch";
import { PatchSets, SerializedPatchSet } from "./PatchSets";
import {
  ChangeTreeNode,
  computeChangedSourcePaths,
} from "./computeChangedSourcePaths";

const { s } = initVal();

const mockRouter = {
  getRouterId: () => "next-app-router",
  validate: () => [],
};

const schema = s
  .record(
    s.object({
      title: s.string(),
      body: s.richtext(),
      status: s.union(
        s.literal("draft"),
        s.literal("published"),
        s.literal("archived"),
      ),
    }),
  )
  .router(mockRouter);

type TestPatch = {
  patchId: PatchId;
  patch: Patch;
  createdAt: string;
  author: string | null;
};

function buildPatchSets(
  moduleFilePath: ModuleFilePath,
  s: Schema<SelectorSource>,
  patches: TestPatch[],
): SerializedPatchSet {
  const patchSets = new PatchSets();
  for (const p of patches) {
    patchSets.insert(
      moduleFilePath,
      s["executeSerialize"](),
      p.patch,
      p.patchId,
      p.createdAt,
      p.author,
    );
  }
  return patchSets.serialize();
}

const MODULE_FILE_PATH = "/app/pages/[page]/page.val.ts" as ModuleFilePath;

describe("computeChangedSourcePaths", () => {
  test("single page added", () => {
    const patchSets = buildPatchSets(MODULE_FILE_PATH, schema, [
      {
        patchId: "patch-add-1" as PatchId,
        patch: [
          {
            op: "add",
            path: ["/contact"],
            value: {
              title: "Contact Us",
              body: [{ tag: "p", children: ["Hello"] }],
              status: "draft",
            },
          },
        ],
        createdAt: "2025-04-01T10:00:00Z",
        author: "alice",
      },
    ]);

    const result = computeChangedSourcePaths(patchSets);
    expect(result).toMatchSnapshot();
  });

  test("single page removed", () => {
    const patchSets = buildPatchSets(MODULE_FILE_PATH, schema, [
      {
        patchId: "patch-remove-1" as PatchId,
        patch: [
          {
            op: "remove",
            path: ["/about"],
          },
        ],
        createdAt: "2025-04-02T09:00:00Z",
        author: "bob",
      },
    ]);

    const result = computeChangedSourcePaths(patchSets);
    expect(result).toMatchSnapshot();
  });

  test("field-level replace", () => {
    const patchSets = buildPatchSets(MODULE_FILE_PATH, schema, [
      {
        patchId: "patch-title-1" as PatchId,
        patch: [
          {
            op: "replace",
            path: ["/home", "title"],
            value: "Updated Title",
          },
        ],
        createdAt: "2025-04-03T08:00:00Z",
        author: "alice",
      },
      {
        patchId: "patch-status-1" as PatchId,
        patch: [
          {
            op: "replace",
            path: ["/home", "status"],
            value: "published",
          },
        ],
        createdAt: "2025-04-03T08:05:00Z",
        author: "alice",
      },
    ]);

    const result = computeChangedSourcePaths(patchSets);
    expect(result).toMatchSnapshot();
  });

  test("add then remove same path cancels out", () => {
    const patchSets = buildPatchSets(MODULE_FILE_PATH, schema, [
      {
        patchId: "patch-add-1" as PatchId,
        patch: [
          {
            op: "add",
            path: ["/temp"],
            value: {
              title: "Temp",
              body: [{ tag: "p", children: ["temp"] }],
              status: "draft",
            },
          },
        ],
        createdAt: "2025-04-01T10:00:00Z",
        author: "alice",
      },
      {
        patchId: "patch-remove-1" as PatchId,
        patch: [
          {
            op: "remove",
            path: ["/temp"],
          },
        ],
        createdAt: "2025-04-01T11:00:00Z",
        author: "alice",
      },
    ]);

    const result = computeChangedSourcePaths(patchSets);
    expect(result).toMatchSnapshot();
  });

  test("multiple modules sorted by last changed", () => {
    const moduleA = "/app/pages/a.val.ts" as ModuleFilePath;
    const moduleB = "/app/pages/b.val.ts" as ModuleFilePath;

    const schemaSimple = s.record(s.object({ title: s.string() }));

    const patchSetsA = buildPatchSets(moduleA, schemaSimple, [
      {
        patchId: "patch-a-1" as PatchId,
        patch: [{ op: "replace", path: ["/page1", "title"], value: "A" }],
        createdAt: "2025-04-01T10:00:00Z",
        author: "alice",
      },
    ]);

    const patchSetsB = buildPatchSets(moduleB, schemaSimple, [
      {
        patchId: "patch-b-1" as PatchId,
        patch: [{ op: "replace", path: ["/page1", "title"], value: "B" }],
        createdAt: "2025-04-02T10:00:00Z",
        author: "bob",
      },
    ]);

    const combined = [...patchSetsA, ...patchSetsB];
    const result = computeChangedSourcePaths(combined);
    expect(result).toMatchSnapshot();
  });

  test("nested field changes produce tree with alphabetical children", () => {
    const patchSets = buildPatchSets(MODULE_FILE_PATH, schema, [
      {
        patchId: "patch-status-1" as PatchId,
        patch: [
          {
            op: "replace",
            path: ["/home", "status"],
            value: "published",
          },
        ],
        createdAt: "2025-04-03T08:00:00Z",
        author: "alice",
      },
      {
        patchId: "patch-body-1" as PatchId,
        patch: [
          {
            op: "replace",
            path: ["/home", "body"],
            value: [{ tag: "p", children: ["New body"] }],
          },
        ],
        createdAt: "2025-04-03T09:00:00Z",
        author: "bob",
      },
    ]);

    const result = computeChangedSourcePaths(patchSets);
    expect(result).toMatchSnapshot();
  });

  describe("the deploy line", () => {
    const simpleSchema = s.record(s.object({ title: s.string() }));

    test("with nothing committed, every tree is pending", () => {
      const patchSets = buildPatchSets(MODULE_FILE_PATH, simpleSchema, [
        {
          patchId: "patch-1" as PatchId,
          patch: [{ op: "replace", path: ["/home", "title"], value: "One" }],
          createdAt: "2025-04-01T10:00:00Z",
          author: "alice",
        },
      ]);

      const { trees } = computeChangedSourcePaths(patchSets);

      expect(trees).toHaveLength(1);
      expect(trees[0].isCommitted).toBe(false);
    });

    test("a patch set whose patches have all shipped becomes a committed tree", () => {
      const patchSets = buildPatchSets(MODULE_FILE_PATH, simpleSchema, [
        {
          patchId: "patch-1" as PatchId,
          patch: [{ op: "replace", path: ["/home", "title"], value: "One" }],
          createdAt: "2025-04-01T10:00:00Z",
          author: "alice",
        },
      ]);

      const { trees } = computeChangedSourcePaths(
        patchSets,
        new Set(["patch-1" as PatchId]),
      );

      expect(trees).toHaveLength(1);
      expect(trees[0].isCommitted).toBe(true);
    });

    test("isCommitted reaches the nested node the change is on", () => {
      const patchSets = buildPatchSets(MODULE_FILE_PATH, simpleSchema, [
        {
          patchId: "patch-1" as PatchId,
          patch: [{ op: "replace", path: ["/home", "title"], value: "One" }],
          createdAt: "2025-04-01T10:00:00Z",
          author: "alice",
        },
      ]);

      const { trees } = computeChangedSourcePaths(
        patchSets,
        new Set(["patch-1" as PatchId]),
      );

      // The row that actually carries the change is a descendant of the module
      // root, and it is the row whose discard control has to disappear.
      const leaves = flatten(trees[0]).filter((node) => node.change);
      expect(leaves.length).toBeGreaterThan(0);
      for (const leaf of leaves) {
        expect(leaf.isCommitted).toBe(true);
      }
    });

    /**
     * The case the divider exists for: one field edited before a publish and
     * again after it. The patch set groups by PATH, so both patches are in the
     * same set — and that set belongs on neither side of the line as a whole.
     */
    test("a patch set straddling the line is split, and each half keeps only its own patches", () => {
      const patchSets = buildPatchSets(MODULE_FILE_PATH, simpleSchema, [
        {
          patchId: "shipped" as PatchId,
          patch: [
            { op: "replace", path: ["/home", "title"], value: "Published" },
          ],
          createdAt: "2025-04-01T10:00:00Z",
          author: "alice",
        },
        {
          patchId: "pending" as PatchId,
          patch: [
            { op: "replace", path: ["/home", "title"], value: "Edited since" },
          ],
          createdAt: "2025-04-02T10:00:00Z",
          author: "bob",
        },
      ]);
      // One set, both patches: this is the precondition the split is about.
      expect(patchSets).toHaveLength(1);
      expect(patchSets[0].patches.map((p) => p.patchId).sort()).toEqual([
        "pending",
        "shipped",
      ]);

      const { trees } = computeChangedSourcePaths(
        patchSets,
        new Set(["shipped" as PatchId]),
      );

      expect(trees).toHaveLength(2);
      const [pendingTree, committedTree] = trees;
      expect(pendingTree.isCommitted).toBe(false);
      expect(committedTree.isCommitted).toBe(true);
      // Same module on both sides — the module is two cards, not one.
      expect(pendingTree.sourcePath).toBe(MODULE_FILE_PATH);
      expect(committedTree.sourcePath).toBe(MODULE_FILE_PATH);
      expect(patchIdsOf(pendingTree)).toEqual(["pending"]);
      expect(patchIdsOf(committedTree)).toEqual(["shipped"]);
    });

    test("each half is credited to its own author and its own timestamp", () => {
      const patchSets = buildPatchSets(MODULE_FILE_PATH, simpleSchema, [
        {
          patchId: "shipped" as PatchId,
          patch: [
            { op: "replace", path: ["/home", "title"], value: "Published" },
          ],
          createdAt: "2025-04-01T10:00:00Z",
          author: "alice",
        },
        {
          patchId: "pending" as PatchId,
          patch: [
            { op: "replace", path: ["/home", "title"], value: "Edited since" },
          ],
          createdAt: "2025-04-02T10:00:00Z",
          author: "bob",
        },
      ]);

      const { trees } = computeChangedSourcePaths(
        patchSets,
        new Set(["shipped" as PatchId]),
      );

      const [pendingTree, committedTree] = trees;
      // Inheriting these from the whole set would have the pending half
      // credited to the author and the moment of a commit already out the door.
      expect(changeOf(pendingTree).authors).toEqual(["bob"]);
      expect(changeOf(committedTree).authors).toEqual(["alice"]);
      expect(pendingTree.lastUpdated).toBe("2025-04-02T10:00:00Z");
      expect(committedTree.lastUpdated).toBe("2025-04-01T10:00:00Z");
    });

    test("pending trees sort above committed ones even when the committed work is newer", () => {
      const olderPending = buildPatchSets(
        "/app/pages/a.val.ts" as ModuleFilePath,
        simpleSchema,
        [
          {
            patchId: "pending-old" as PatchId,
            patch: [{ op: "replace", path: ["/page", "title"], value: "A" }],
            createdAt: "2025-04-01T10:00:00Z",
            author: "alice",
          },
        ],
      );
      const newerCommitted = buildPatchSets(
        "/app/pages/b.val.ts" as ModuleFilePath,
        simpleSchema,
        [
          {
            patchId: "committed-new" as PatchId,
            patch: [{ op: "replace", path: ["/page", "title"], value: "B" }],
            createdAt: "2025-04-09T10:00:00Z",
            author: "bob",
          },
        ],
      );

      const { trees } = computeChangedSourcePaths(
        [...newerCommitted, ...olderPending],
        new Set(["committed-new" as PatchId]),
      );

      // Newest-first would put the committed tree on top, which would put it
      // above the divider and call shipped work discardable.
      expect(trees.map((tree) => tree.isCommitted)).toEqual([false, true]);
    });
  });
});

function flatten(node: ChangeTreeNode): ChangeTreeNode[] {
  return [node, ...node.children.flatMap(flatten)];
}

function patchIdsOf(node: ChangeTreeNode): string[] {
  const ids = new Set<string>();
  for (const child of flatten(node)) {
    for (const id of child.change?.patchIds ?? []) {
      ids.add(id);
    }
  }
  return [...ids];
}

function changeOf(node: ChangeTreeNode): NonNullable<ChangeTreeNode["change"]> {
  const withChange = flatten(node).find((child) => child.change);
  if (!withChange?.change) {
    throw new Error("no change in tree");
  }
  return withChange.change;
}

/**
 * A multi-op patch is ONE patch, not one per op.
 *
 * `PatchSets.insert` records every op, so a patch touching two paths in the
 * same patch set appears twice in `patchSet.patches` — deliberately, since each
 * entry carries its own `patchPath`. Anything deriving PATCH ids from it has to
 * collapse them, or one edit is counted as two: the staging controls would say
 * "2 changes" for one save, and the closure would be handed a list with repeats.
 *
 * Regression cover for the whole-patch `insert` change, whose old per-patch
 * de-duplication masked this by dropping every op after the first.
 */
describe("a patch with several ops in one patch set", () => {
  test("counts once in patchIds and once per author", () => {
    const patchSets = buildPatchSets(MODULE_FILE_PATH, schema, [
      {
        patchId: "patch-multi" as PatchId,
        /*
         * TWO OPS ON THE SAME PATH, which is what makes this reproduce. Two ops
         * at DIFFERENT paths land in different tree nodes, so neither node ever
         * sees the id twice — a fixture like that passes with the bug present.
         * A field edited twice inside one debounce window produces exactly this.
         */
        patch: [
          { op: "replace", path: ["/contact", "title"], value: "One" },
          { op: "replace", path: ["/contact", "title"], value: "Two" },
        ],
        createdAt: "2025-04-01T10:00:00Z",
        author: "alice",
      },
    ]);

    // Both ops really are recorded — that is what the array is for.
    const recorded = patchSets.flatMap((set) =>
      set.patches.map((patch) => patch.patchId),
    );
    expect(recorded).toEqual(["patch-multi", "patch-multi"]);

    const res = computeChangedSourcePaths(patchSets);
    const ids = new Set<string>();
    const authorEdits: unknown[] = [];
    const walk = (node: ChangeTreeNode): void => {
      if (node.change) {
        for (const id of node.change.patchIds) ids.add(id);
        for (const edits of Object.values(node.change.patchesByAuthorIds)) {
          authorEdits.push(...edits);
        }
      }
      for (const child of node.children) walk(child);
    };
    for (const tree of res.trees) walk(tree);

    expect([...ids]).toEqual(["patch-multi"]);
    // One edit, not two, for the one author.
    expect(authorEdits).toHaveLength(1);
  });
});
