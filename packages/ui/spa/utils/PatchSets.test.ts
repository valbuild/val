import {
  initVal,
  ModuleFilePath,
  PatchId,
  Schema,
  SelectorSource,
} from "@valbuild/core";
import { Patch } from "@valbuild/core/patch";
import { PatchSets } from "./PatchSets";

const { s } = initVal();
describe("PatchSet", () => {
  test("record: replace two different", async () => {
    const patchSet = testPatchSet(
      "/content/projects.val.ts" as ModuleFilePath,
      s.record(s.object({ title: s.string(), description: s.string() })),
      [
        {
          patchId: "123" as PatchId,
          patch: [
            {
              op: "replace",
              path: ["Project A", "title"],
              value: "New Title",
            },
          ],
          createdAt: "2021-01-01T00:00:00Z",
          author: "author1",
        },
        {
          patchId: "234" as PatchId,
          patch: [
            {
              op: "replace",
              path: ["Project A", "description"],
              value: "New Description",
            },
          ],
          createdAt: "2021-01-02T00:00:00Z",
          author: "author1",
        },
      ],
    );
    const expected = [
      {
        moduleFilePath: "/content/projects.val.ts",
        patchPath: ["Project A", "description"],
        patches: [
          {
            patchPath: ["Project A", "description"],
            patchId: "234",
            author: "author1",
            createdAt: "2021-01-02T00:00:00Z",
            opType: "replace",
            schemaTypes: ["string"],
          },
        ],
        authors: ["author1"],
        opTypes: ["replace"],
        schemaTypes: ["string"],
        lastUpdated: "2021-01-02T00:00:00Z",
        lastUpdatedBy: "author1",
      },
      {
        moduleFilePath: "/content/projects.val.ts",
        patchPath: ["Project A", "title"],
        patches: [
          {
            patchPath: ["Project A", "title"],
            patchId: "123",
            author: "author1",
            createdAt: "2021-01-01T00:00:00Z",
            opType: "replace",
            schemaTypes: ["string"],
          },
        ],
        authors: ["author1"],
        opTypes: ["replace"],
        schemaTypes: ["string"],
        lastUpdated: "2021-01-01T00:00:00Z",
        lastUpdatedBy: "author1",
      },
    ];
    expect(patchSet.serialize()).toEqual(expected);
  });

  test("multi module bonanza", async () => {
    const patchSet = testPatchSet(
      "/content/projects.val.ts" as ModuleFilePath,
      s.record(s.object({ title: s.string(), description: s.string() })),
      [
        {
          patchId: "123" as PatchId,
          patch: [
            {
              op: "replace",
              path: ["Project A", "title"],
              value: "New Title",
            },
          ],
          createdAt: "2021-01-01T00:00:00Z",
          author: "author1",
        },
        {
          patchId: "234" as PatchId,
          patch: [
            {
              op: "replace",
              path: ["Project A", "description"],
              value: "New Description",
            },
          ],
          createdAt: "2021-01-02T00:00:00Z",
          author: "author1",
        },
      ],
    );
    testPatchSet(
      "/content/projects2.val.ts" as ModuleFilePath,
      s.record(s.object({ title: s.string(), description: s.string() })),
      [
        {
          patchId: "345" as PatchId,
          patch: [
            {
              op: "replace",
              path: ["Project A", "title"],
              value: "New Title",
            },
          ],
          createdAt: "2021-01-03T00:00:00Z",
          author: "author1",
        },
        {
          patchId: "456" as PatchId,
          patch: [
            {
              op: "replace",
              path: ["Project A", "title"],
              value: "New Title 2",
            },
          ],
          createdAt: "2021-01-04T00:00:00Z",
          author: "author1",
        },
      ],
      patchSet,
    );
    testPatchSet(
      "/content/projects.val.ts" as ModuleFilePath,
      s.record(s.object({ title: s.string(), description: s.string() })),
      [
        {
          patchId: "567" as PatchId,
          patch: [
            {
              op: "replace",
              path: ["Project A", "title"],
              value: "New Title 3",
            },
          ],
          createdAt: "2021-01-05T00:00:00Z",
          author: "author1",
        },
      ],
      patchSet,
    );
    const expected = [
      {
        moduleFilePath: "/content/projects.val.ts",
        patchPath: ["Project A", "title"],
        patches: [
          {
            patchPath: ["Project A", "title"],
            patchId: "567",
            author: "author1",
            createdAt: "2021-01-05T00:00:00Z",
            opType: "replace",
            schemaTypes: ["string"],
          },
          {
            patchPath: ["Project A", "title"],
            patchId: "123",
            author: "author1",
            createdAt: "2021-01-01T00:00:00Z",
            opType: "replace",
            schemaTypes: ["string"],
          },
        ],
        authors: ["author1"],
        opTypes: ["replace"],
        schemaTypes: ["string"],
        lastUpdated: "2021-01-05T00:00:00Z",
        lastUpdatedBy: "author1",
      },
      {
        moduleFilePath: "/content/projects2.val.ts",
        patchPath: ["Project A", "title"],
        patches: [
          {
            patchPath: ["Project A", "title"],
            patchId: "456",
            author: "author1",
            createdAt: "2021-01-04T00:00:00Z",
            opType: "replace",
            schemaTypes: ["string"],
          },
          {
            patchPath: ["Project A", "title"],
            patchId: "345",
            author: "author1",
            createdAt: "2021-01-03T00:00:00Z",
            opType: "replace",
            schemaTypes: ["string"],
          },
        ],
        authors: ["author1"],
        opTypes: ["replace"],
        schemaTypes: ["string"],
        lastUpdated: "2021-01-04T00:00:00Z",
        lastUpdatedBy: "author1",
      },
      {
        moduleFilePath: "/content/projects.val.ts",
        patchPath: ["Project A", "description"],
        patches: [
          {
            patchPath: ["Project A", "description"],
            patchId: "234",
            author: "author1",
            createdAt: "2021-01-02T00:00:00Z",
            opType: "replace",
            schemaTypes: ["string"],
          },
        ],
        authors: ["author1"],
        opTypes: ["replace"],
        schemaTypes: ["string"],
        lastUpdated: "2021-01-02T00:00:00Z",
        lastUpdatedBy: "author1",
      },
    ];

    console.log(JSON.stringify(patchSet.serialize(), null, 2));
    expect(patchSet.serialize()).toEqual(expected);
  });

  test("record: replace same", async () => {
    const patchSet = testPatchSet(
      "/content/projects.val.ts" as ModuleFilePath,
      s.record(s.object({ title: s.string(), description: s.string() })),
      [
        {
          patchId: "123" as PatchId,
          patch: [
            {
              op: "replace",
              path: ["Project A", "title"],
              value: "New Title",
            },
          ],
          createdAt: "2021-01-01T00:00:00Z",
          author: "author1",
        },
        {
          patchId: "234" as PatchId,
          patch: [
            {
              op: "replace",
              path: ["Project A", "title"],
              value: "New Title 2",
            },
          ],
          createdAt: "2021-01-02T00:00:00Z",
          author: "author2",
        },
      ],
    );
    const expected = [
      {
        moduleFilePath: "/content/projects.val.ts",
        patchPath: ["Project A", "title"],
        patches: [
          {
            patchId: "234",
            author: "author2",
            createdAt: "2021-01-02T00:00:00Z",
            opType: "replace",
            schemaTypes: ["string"],
            patchPath: ["Project A", "title"],
          },
          {
            patchId: "123",
            author: "author1",
            createdAt: "2021-01-01T00:00:00Z",
            opType: "replace",
            schemaTypes: ["string"],
            patchPath: ["Project A", "title"],
          },
        ],
        authors: ["author2", "author1"],
        opTypes: ["replace"],
        schemaTypes: ["string"],
        lastUpdated: "2021-01-02T00:00:00Z",
        lastUpdatedBy: "author2",
      },
    ];
    expect(patchSet.serialize()).toEqual(expected);
  });

  test("record at module: add", async () => {
    const patchSet = testPatchSet(
      "/content/projects.val.ts" as ModuleFilePath,
      s.record(s.object({ title: s.string(), description: s.string() })),
      [
        {
          patchId: "456" as PatchId,
          patch: [
            {
              op: "add",
              path: ["Project_B"],
              value: {
                title: "Title",
                description: "Description",
              },
            },
          ],
          createdAt: "2021-01-03T00:00:00Z",
          author: "author1",
        },
      ],
    );
    const expected = [
      {
        moduleFilePath: "/content/projects.val.ts",
        patchPath: [],
        patches: [
          {
            patchPath: [],
            patchId: "456",
            author: "author1",
            createdAt: "2021-01-03T00:00:00Z",
            opType: "add",
            schemaTypes: ["record"],
          },
        ],
        authors: ["author1"],
        opTypes: ["add"],
        schemaTypes: ["record"],
        lastUpdated: "2021-01-03T00:00:00Z",
        lastUpdatedBy: "author1",
      },
    ];
    expect(patchSet.serialize()).toEqual(expected);
  });

  test("record at module: add -> replace", async () => {
    const patchSet = testPatchSet(
      "/content/projects.val.ts" as ModuleFilePath,
      s.record(s.object({ title: s.string(), description: s.string() })),
      [
        {
          patchId: "456" as PatchId,
          patch: [
            {
              op: "add",
              path: ["Project_B"],
              value: {
                title: "Title",
                description: "Description",
              },
            },
          ],
          createdAt: "2021-01-03T00:00:00Z",
          author: "author1",
        },
        {
          patchId: "567" as PatchId,
          patch: [
            {
              op: "replace",
              path: ["Project_B", "description"],
              value: "Another Description",
            },
          ],
          createdAt: "2021-01-04T00:00:00Z",
          author: "author1",
        },
      ],
    );
    const expected = [
      {
        moduleFilePath: "/content/projects.val.ts",
        patchPath: [],
        patches: [
          {
            patchPath: ["Project_B", "description"],
            patchId: "567",
            author: "author1",
            createdAt: "2021-01-04T00:00:00Z",
            opType: "replace",
            schemaTypes: ["string"],
          },
          {
            patchPath: [],
            patchId: "456",
            author: "author1",
            createdAt: "2021-01-03T00:00:00Z",
            opType: "add",
            schemaTypes: ["record"],
          },
        ],
        authors: ["author1"],
        opTypes: ["replace", "add"],
        schemaTypes: ["record"],
        lastUpdated: "2021-01-04T00:00:00Z",
        lastUpdatedBy: "author1",
      },
    ];
    expect(patchSet.serialize()).toEqual(expected);
  });

  test("record at module: replace -> add -> replace", async () => {
    const patchSet = testPatchSet(
      "/content/projects.val.ts" as ModuleFilePath,
      s.record(s.object({ title: s.string(), description: s.string() })),
      [
        {
          patchId: "123" as PatchId,
          patch: [
            {
              op: "replace",
              path: ["Project A", "title"],
              value: "New Title",
            },
          ],
          createdAt: "2021-01-01T00:00:00Z",
          author: "author1",
        },
        {
          patchId: "456" as PatchId,
          patch: [
            {
              op: "add",
              path: ["Project_B"],
              value: {
                title: "Title",
                description: "Description",
              },
            },
          ],
          createdAt: "2021-01-03T00:00:00Z",
          author: "author1",
        },
        {
          patchId: "567" as PatchId,
          patch: [
            {
              op: "replace",
              path: ["Project_B", "description"],
              value: "Another Description",
            },
          ],
          createdAt: "2021-01-04T00:00:00Z",
          author: "author1",
        },
      ],
    );
    const expected = [
      {
        moduleFilePath: "/content/projects.val.ts",
        patchPath: [],
        patches: [
          {
            patchPath: ["Project_B", "description"],
            patchId: "567",
            author: "author1",
            createdAt: "2021-01-04T00:00:00Z",
            opType: "replace",
            schemaTypes: ["string"],
          },
          {
            patchPath: [],
            patchId: "456",
            author: "author1",
            createdAt: "2021-01-03T00:00:00Z",
            opType: "add",
            schemaTypes: ["record"],
          },
          {
            patchPath: ["Project A", "title"],
            patchId: "123",
            author: "author1",
            createdAt: "2021-01-01T00:00:00Z",
            opType: "replace",
            schemaTypes: ["string"],
          },
        ],
        authors: ["author1"],
        opTypes: ["add", "replace"],
        schemaTypes: ["record"],
        lastUpdated: "2021-01-04T00:00:00Z",
        lastUpdatedBy: "author1",
      },
    ];
    expect(patchSet.serialize()).toEqual(expected);
  });

  test("record in object: replace", async () => {
    const patchSet = testPatchSet(
      "/content/projects.val.ts" as ModuleFilePath,
      s.object({
        record: s.record(
          s.object({ title: s.string(), description: s.string() }),
        ),
      }),
      [
        {
          patchId: "123" as PatchId,
          patch: [
            {
              op: "replace",
              path: ["record", "Project A", "title"],
              value: "New Title",
            },
          ],
          createdAt: "2021-01-01T00:00:00Z",
          author: "author1",
        },
      ],
    );
    const expected = [
      {
        moduleFilePath: "/content/projects.val.ts",
        patchPath: ["record", "Project A", "title"],
        patches: [
          {
            patchPath: ["record", "Project A", "title"],
            patchId: "123",
            author: "author1",
            createdAt: "2021-01-01T00:00:00Z",
            opType: "replace",
            schemaTypes: ["string"],
          },
        ],
        authors: ["author1"],
        opTypes: ["replace"],
        schemaTypes: ["string"],
        lastUpdated: "2021-01-01T00:00:00Z",
        lastUpdatedBy: "author1",
      },
    ];
    expect(patchSet.serialize()).toEqual(expected);
  });

  test("record in object: replace -> add", async () => {
    const patchSet = testPatchSet(
      "/content/projects.val.ts" as ModuleFilePath,
      s.object({
        record: s.record(
          s.object({ title: s.string(), description: s.string() }),
        ),
      }),
      [
        {
          patchId: "123" as PatchId,
          patch: [
            {
              op: "replace",
              path: ["record", "Project A", "title"],
              value: "New Title",
            },
          ],
          createdAt: "2021-01-01T00:00:00Z",
          author: "author1",
        },
        {
          patchId: "234" as PatchId,
          patch: [
            {
              op: "add",
              path: ["record", "Project_B"],
              value: {
                title: "Title",
                description: "Description",
              },
            },
          ],
          createdAt: "2021-01-02T00:00:00Z",
          author: "author1",
        },
      ],
    );
    const expected = [
      {
        moduleFilePath: "/content/projects.val.ts",
        patchPath: ["record"],
        patches: [
          {
            patchPath: ["record"],
            patchId: "234",
            author: "author1",
            createdAt: "2021-01-02T00:00:00Z",
            opType: "add",
            schemaTypes: ["record"],
          },
          {
            patchPath: ["record", "Project A", "title"],
            patchId: "123",
            author: "author1",
            createdAt: "2021-01-01T00:00:00Z",
            opType: "replace",
            schemaTypes: ["string"],
          },
        ],
        authors: ["author1"],
        opTypes: ["add", "replace"],
        schemaTypes: ["record"],
        lastUpdated: "2021-01-02T00:00:00Z",
        lastUpdatedBy: "author1",
      },
    ];
    expect(patchSet.serialize()).toEqual(expected);
  });

  test("record in object: replace -> add -> replace", async () => {
    const patchSet = testPatchSet(
      "/content/projects.val.ts" as ModuleFilePath,
      s.object({
        record: s.record(
          s.object({ title: s.string(), description: s.string() }),
        ),
      }),
      [
        {
          patchId: "123" as PatchId,
          patch: [
            {
              op: "replace",
              path: ["record", "Project A", "title"],
              value: "New Title",
            },
          ],
          createdAt: "2021-01-01T00:00:00Z",
          author: "author1",
        },
        {
          patchId: "234" as PatchId,
          patch: [
            {
              op: "add",
              path: ["record", "Project_B"],
              value: {
                title: "Title",
                description: "Description",
              },
            },
          ],
          createdAt: "2021-01-02T00:00:00Z",
          author: "author1",
        },
        {
          patchId: "345" as PatchId,
          patch: [
            {
              op: "replace",
              path: ["record", "Project_B", "title"],
              value: "New Title",
            },
          ],
          createdAt: "2021-01-03T00:00:00Z",
          author: "author2",
        },
      ],
    );
    const expected = [
      {
        moduleFilePath: "/content/projects.val.ts",
        patchPath: ["record"],
        patches: [
          {
            patchPath: ["record", "Project_B", "title"],
            patchId: "345",
            author: "author2",
            createdAt: "2021-01-03T00:00:00Z",
            opType: "replace",
            schemaTypes: ["string"],
          },
          {
            patchPath: ["record"],
            patchId: "234",
            author: "author1",
            createdAt: "2021-01-02T00:00:00Z",
            opType: "add",
            schemaTypes: ["record"],
          },
          {
            patchPath: ["record", "Project A", "title"],
            patchId: "123",
            author: "author1",
            createdAt: "2021-01-01T00:00:00Z",
            opType: "replace",
            schemaTypes: ["string"],
          },
        ],
        authors: ["author2", "author1"],
        opTypes: ["add", "replace"],
        schemaTypes: ["record"],
        lastUpdated: "2021-01-03T00:00:00Z",
        lastUpdatedBy: "author2",
      },
    ];
    expect(patchSet.serialize()).toEqual(expected);
  });
});

function testPatchSet(
  moduleFilePath: ModuleFilePath,
  schema: Schema<SelectorSource>,
  patches: TestData[],
  prev?: PatchSets,
) {
  const patchSet = prev || new PatchSets();
  for (const patch of patches) {
    for (const op of patch.patch) {
      patchSet.insert(
        moduleFilePath,
        schema.serialize(),
        op,
        patch.patchId,
        patch.createdAt,
        patch.author,
      );
    }
  }
  return patchSet;
}

type TestData = {
  patchId: PatchId;
  patch: Patch;
  createdAt: string;
  author: string | null;
};
