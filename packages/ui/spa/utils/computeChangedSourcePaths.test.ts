import {
  initVal,
  ModuleFilePath,
  PatchId,
  Schema,
  SelectorSource,
  SourcePath,
} from "@valbuild/core";
import { Patch } from "@valbuild/core/patch";
import { PatchSets, SerializedPatchSet } from "./PatchSets";
import {
  ChangeTreeNode,
  computeChangedSourcePaths,
  getSegment,
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
    for (const op of p.patch) {
      patchSets.insert(
        moduleFilePath,
        s["executeSerialize"](),
        op,
        p.patchId,
        p.createdAt,
        p.author,
      );
    }
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
});

describe("getSegment", () => {
  test("returns moduleFilePath for root nodes", () => {
    const node: ChangeTreeNode = {
      sourcePath: "/app/pages.val.ts" as ModuleFilePath,
      lastUpdated: "2025-01-01T00:00:00Z",
      children: [],
    };
    expect(getSegment(node)).toMatchSnapshot();
  });

  test("returns last segment for source paths", () => {
    const node: ChangeTreeNode = {
      sourcePath:
        '/app/pages.val.ts?p="/home"."title"' as unknown as SourcePath,
      lastUpdated: "2025-01-01T00:00:00Z",
      children: [],
    };
    expect(getSegment(node)).toMatchSnapshot();
  });
});
