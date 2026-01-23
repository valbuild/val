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
  // #region record
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

  test("record: multi module bonanza", async () => {
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
    // console.log(JSON.stringify(patchSet.serialize(), null, 2));
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
        patchPath: ["Project_B"],
        patches: [
          {
            patchPath: ["Project_B"],
            patchId: "456",
            author: "author1",
            createdAt: "2021-01-03T00:00:00Z",
            opType: "add",
            schemaTypes: ["object"],
          },
        ],
        authors: ["author1"],
        opTypes: ["add"],
        schemaTypes: ["object"],
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
        patchPath: ["Project_B"],
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
            patchPath: ["Project_B"],
            patchId: "456",
            author: "author1",
            createdAt: "2021-01-03T00:00:00Z",
            opType: "add",
            schemaTypes: ["object"],
          },
        ],
        authors: ["author1"],
        opTypes: ["replace", "add"],
        schemaTypes: ["object"],
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
        patchPath: ["Project_B"],
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
            patchPath: ["Project_B"],
            patchId: "456",
            author: "author1",
            createdAt: "2021-01-03T00:00:00Z",
            opType: "add",
            schemaTypes: ["object"],
          },
        ],
        authors: ["author1"],
        opTypes: ["replace", "add"],
        schemaTypes: ["object"],
        lastUpdated: "2021-01-04T00:00:00Z",
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

  test("record in object: replace.", async () => {
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

  test("record in object: replace -> add.", async () => {
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
        patchPath: ["record", "Project_B"],
        patches: [
          {
            patchPath: ["record", "Project_B"],
            patchId: "234",
            author: "author1",
            createdAt: "2021-01-02T00:00:00Z",
            opType: "add",
            schemaTypes: ["object"],
          },
        ],
        authors: ["author1"],
        opTypes: ["add"],
        schemaTypes: ["object"],
        lastUpdated: "2021-01-02T00:00:00Z",
        lastUpdatedBy: "author1",
      },
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

  test("record in object: replace -> add -> replace.", async () => {
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
        patchPath: ["record", "Project_B"],
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
            patchPath: ["record", "Project_B"],
            patchId: "234",
            author: "author1",
            createdAt: "2021-01-02T00:00:00Z",
            opType: "add",
            schemaTypes: ["object"],
          },
        ],
        authors: ["author2", "author1"],
        opTypes: ["replace", "add"],
        schemaTypes: ["object"],
        lastUpdated: "2021-01-03T00:00:00Z",
        lastUpdatedBy: "author2",
      },
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

  // #region array
  test("array in object: replace -> add -> replace.", async () => {
    const patchSet = testPatchSet(
      "/content/projects.val.ts" as ModuleFilePath,
      s.object({
        array: s.array(
          s.object({ title: s.string(), description: s.string() }),
        ),
      }),
      [
        {
          patchId: "123" as PatchId,
          patch: [
            {
              op: "replace",
              path: ["array", "0", "title"],
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
              path: ["array", "1"],
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
              path: ["array", "1", "title"],
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
        patchPath: ["array"],
        patches: [
          {
            patchPath: ["array", "1", "title"],
            patchId: "345",
            author: "author2",
            createdAt: "2021-01-03T00:00:00Z",
            opType: "replace",
            schemaTypes: ["string"],
          },
          {
            patchPath: ["array", "1"],
            patchId: "234",
            author: "author1",
            createdAt: "2021-01-02T00:00:00Z",
            opType: "add",
            schemaTypes: ["array"],
          },
          {
            patchPath: ["array", "0", "title"],
            patchId: "123",
            author: "author1",
            createdAt: "2021-01-01T00:00:00Z",
            opType: "replace",
            schemaTypes: ["string"],
          },
        ],
        authors: ["author2", "author1"],
        opTypes: ["add", "replace"],
        schemaTypes: ["array"],
        lastUpdated: "2021-01-03T00:00:00Z",
        lastUpdatedBy: "author2",
      },
    ];
    expect(patchSet.serialize()).toEqual(expected);
  });

  // #region union
  test("union of record in object: replace -> add -> replace.", async () => {
    const patchSet = testPatchSet(
      "/content/projects.val.ts" as ModuleFilePath,
      s.object({
        record: s.record(
          s.union(
            "type",
            s.object({
              type: s.literal("blog"),
              title: s.string(),
              description: s.string(),
            }),
            s.object({
              type: s.literal("article"),
              name: s.string(),
              text: s.string(),
            }),
          ),
        ),
      }),
      [
        {
          patchId: "123" as PatchId,
          patch: [
            {
              op: "replace",
              path: ["record", "blog1", "title"],
              value: "New Blog Title",
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
              path: ["record", "article1"],
              value: {
                type: "article",
                name: "Article Name",
                text: "Article Text",
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
              path: ["record", "article1", "name"],
              value: "New Article Name",
            },
          ],
          createdAt: "2021-01-03T00:00:00Z",
          author: "author2",
        },
        {
          patchId: "456" as PatchId,
          patch: [
            {
              op: "replace",
              path: ["record", "blog1", "title"],
              value: "New Blog Title 2",
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
        patchPath: ["record", "blog1", "title"],
        patches: [
          {
            patchPath: ["record", "blog1", "title"],
            patchId: "456",
            author: "author2",
            createdAt: "2021-01-03T00:00:00Z",
            opType: "replace",
            schemaTypes: ["string"],
          },
          {
            patchPath: ["record", "blog1", "title"],
            patchId: "123",
            author: "author1",
            createdAt: "2021-01-01T00:00:00Z",
            opType: "replace",
            schemaTypes: ["string"],
          },
        ],
        authors: ["author2", "author1"],
        opTypes: ["replace"],
        schemaTypes: ["string"],
        lastUpdated: "2021-01-03T00:00:00Z",
        lastUpdatedBy: "author2",
      },
      {
        moduleFilePath: "/content/projects.val.ts",
        patchPath: ["record", "article1"],
        patches: [
          {
            patchPath: ["record", "article1", "name"],
            patchId: "345",
            author: "author2",
            createdAt: "2021-01-03T00:00:00Z",
            opType: "replace",
            schemaTypes: ["string"],
          },
          {
            patchPath: ["record", "article1"],
            patchId: "234",
            author: "author1",
            createdAt: "2021-01-02T00:00:00Z",
            opType: "add",
            schemaTypes: ["union", "object"],
          },
        ],
        authors: ["author2", "author1"],
        opTypes: ["replace", "add"],
        schemaTypes: ["union", "object"],
        lastUpdated: "2021-01-03T00:00:00Z",
        lastUpdatedBy: "author2",
      },
    ];
    expect(patchSet.serialize()).toEqual(expected);
  });

  test("union in record: deep unions.", async () => {
    const patchSet = testPatchSet(
      "/content/projects.val.ts" as ModuleFilePath,
      s.object({
        record: s.record(
          s.union(
            "type",
            s.object({
              type: s.literal("type1"),
              value: s.union(
                "sub-type",
                s.object({
                  "sub-type": s.literal("sub-type1"),
                  value: s.string(),
                }),
                s.object({
                  "sub-type": s.literal("sub-type2"),
                  value: s.number(),
                }),
              ),
            }),
            s.object({
              type: s.literal("type1"),
              value: s.union(
                "sub-type",
                s.object({
                  "sub-type": s.literal("sub-type1"),
                  value: s.boolean(),
                }),
                s.object({
                  "sub-type": s.literal("sub-type2"),
                  value: s.object({
                    "sub-type": s.literal("sub-type3"),
                    value: s.number(),
                  }),
                }),
              ),
            }),
          ),
        ),
      }),
      [
        {
          patchId: "123" as PatchId,
          patch: [
            {
              op: "replace",
              path: ["record", "record1", "value", "value"],
              value: "test",
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
              path: ["record", "record2"],
              value: { value: "test" },
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
        patchPath: ["record", "record2"],
        patches: [
          {
            patchPath: ["record", "record2"],
            patchId: "234",
            author: "author1",
            createdAt: "2021-01-02T00:00:00Z",
            opType: "add",
            schemaTypes: ["union", "object"],
          },
        ],
        authors: ["author1"],
        opTypes: ["add"],
        schemaTypes: ["union", "object"],
        lastUpdated: "2021-01-02T00:00:00Z",
        lastUpdatedBy: "author1",
      },
      {
        moduleFilePath: "/content/projects.val.ts",
        patchPath: ["record", "record1", "value", "value"],
        patches: [
          {
            patchPath: ["record", "record1", "value", "value"],
            patchId: "123",
            author: "author1",
            createdAt: "2021-01-01T00:00:00Z",
            opType: "replace",
            schemaTypes: ["string", "number", "boolean", "object"],
          },
        ],
        authors: ["author1"],
        opTypes: ["replace"],
        schemaTypes: ["string", "number", "boolean", "object"],
        lastUpdated: "2021-01-01T00:00:00Z",
        lastUpdatedBy: "author1",
      },
    ];
    expect(patchSet.serialize()).toEqual(expected);
  });

  test("record in union: deep unions.", async () => {
    const patchSet = testPatchSet(
      "/content/projects.val.ts" as ModuleFilePath,
      s.object({
        record: s.record(
          s.union(
            "type",
            s.object({
              type: s.literal("type1"),
              value: s.record(s.object({ value: s.string() })),
            }),
            s.object({
              type: s.literal("type1"),
              value: s.union(
                "sub-type",
                s.object({
                  "sub-type": s.literal("sub-type1"),
                  value: s.boolean(),
                }),
                s.object({
                  "sub-type": s.literal("sub-type2"),
                  value: s.object({
                    "sub-type": s.literal("sub-type3"),
                    value: s.number(),
                  }),
                }),
              ),
            }),
          ),
        ),
      }),
      [
        {
          patchId: "123" as PatchId,
          patch: [
            {
              op: "replace",
              path: ["record", "record1", "value", "innerRecord1", "value"],
              value: "test",
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
              path: ["record", "record2"],
              value: { value: "test" },
            },
          ],
          createdAt: "2021-01-02T00:00:00Z",
          author: "author1",
        },
        {
          patchId: "345" as PatchId,
          patch: [
            {
              op: "add",
              path: ["record", "record1", "value", "innerRecord2"],
              value: {
                value: "test",
              },
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
        patchPath: ["record", "record1", "value"],
        patches: [
          {
            patchPath: ["record", "record1", "value", "innerRecord2"],
            patchId: "345",
            author: "author2",
            createdAt: "2021-01-03T00:00:00Z",
            opType: "add",
            schemaTypes: ["object"],
          },
          {
            patchPath: ["record", "record1", "value", "innerRecord1", "value"],
            patchId: "123",
            author: "author1",
            createdAt: "2021-01-01T00:00:00Z",
            opType: "replace",
            schemaTypes: ["string"],
          },
        ],
        authors: ["author2", "author1"],
        opTypes: ["add", "replace"],
        schemaTypes: ["object"],
        lastUpdated: "2021-01-03T00:00:00Z",
        lastUpdatedBy: "author2",
      },
      {
        moduleFilePath: "/content/projects.val.ts",
        patchPath: ["record", "record2"],
        patches: [
          {
            patchPath: ["record", "record2"],
            patchId: "234",
            author: "author1",
            createdAt: "2021-01-02T00:00:00Z",
            opType: "add",
            schemaTypes: ["union", "object"],
          },
        ],
        authors: ["author1"],
        opTypes: ["add"],
        schemaTypes: ["union", "object"],
        lastUpdated: "2021-01-02T00:00:00Z",
        lastUpdatedBy: "author1",
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
        schema["executeSerialize"](),
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
