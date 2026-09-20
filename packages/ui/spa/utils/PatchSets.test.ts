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
          s.discriminatedUnion(
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
            schemaTypes: ["discriminated-union", "object"],
          },
        ],
        authors: ["author2", "author1"],
        opTypes: ["replace", "add"],
        schemaTypes: ["discriminated-union", "object"],
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
          s.discriminatedUnion(
            "type",
            s.object({
              type: s.literal("type1"),
              value: s.discriminatedUnion(
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
              value: s.discriminatedUnion(
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
            schemaTypes: ["discriminated-union", "object"],
          },
        ],
        authors: ["author1"],
        opTypes: ["add"],
        schemaTypes: ["discriminated-union", "object"],
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
          s.discriminatedUnion(
            "type",
            s.object({
              type: s.literal("type1"),
              value: s.record(s.object({ value: s.string() })),
            }),
            s.object({
              type: s.literal("type1"),
              value: s.discriminatedUnion(
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
            schemaTypes: ["discriminated-union", "object"],
          },
        ],
        authors: ["author1"],
        opTypes: ["add"],
        schemaTypes: ["discriminated-union", "object"],
        lastUpdated: "2021-01-02T00:00:00Z",
        lastUpdatedBy: "author1",
      },
    ];
    expect(patchSet.serialize()).toEqual(expected);
  });

  // #region object
  /**
   * `add` on an OBJECT key is create-or-set, not an insert, so it affects
   * exactly the key it names.
   *
   * The studio writes `add` rather than `replace` here deliberately — it
   * survives the key having gone away in the meantime — and `add` resolves the
   * PARENT of its path, which for `["Project A", "title"]` is an object. That
   * used to fall through to "cannot perform op on non-array or non-record
   * schema", which the caller catches by terminating the WHOLE module into one
   * patch set.
   */
  test("object: add on a key is its own patch set", async () => {
    const patchSet = testPatchSet(
      "/content/projects.val.ts" as ModuleFilePath,
      s.record(s.object({ title: s.string(), description: s.string() })),
      [
        {
          patchId: "123" as PatchId,
          patch: [{ op: "add", path: ["Project A", "title"], value: "A" }],
          createdAt: "2021-01-01T00:00:00Z",
          author: "author1",
        },
        {
          patchId: "234" as PatchId,
          patch: [
            { op: "add", path: ["Project A", "description"], value: "B" },
          ],
          createdAt: "2021-01-02T00:00:00Z",
          author: "author1",
        },
      ],
    );
    const serialized = patchSet.serialize();
    expect(serialized.map((set) => set.patchPath)).toEqual([
      ["Project A", "description"],
      ["Project A", "title"],
    ]);
    expect(serialized.map((set) => set.schemaTypes)).toEqual([
      ["string"],
      ["string"],
    ]);
  });

  /**
   * The case that was reported: typing alt text on a gallery entry.
   *
   * `s.imageset()` serializes as a record whose ITEM is an object of metadata —
   * the file is named by the record's KEY — so the alt write in
   * `ModuleGallery.handleAltTextChange` resolves an `object` parent. Every
   * keystroke logged "Could not resolve path while creating patch set" and
   * collapsed the whole media module into one patch set, so staging any one
   * change in it dragged along the upload and every other keystroke.
   */
  test("imageset: editing alt text does not terminate the module", async () => {
    const entry = "/public/val/images/screenshot_7c28e.png";
    const patchSet = testPatchSet(
      "/content/media.val.ts" as ModuleFilePath,
      s.imageset({
        accept: "image/*",
        dir: "/public/val/images",
        alt: s.string().minLength(4),
      }),
      [
        {
          patchId: "123" as PatchId,
          patch: [
            {
              op: "add",
              path: [entry],
              value: {
                width: 496,
                height: 582,
                mimeType: "image/png",
                alt: null,
              },
            },
          ],
          createdAt: "2021-01-01T00:00:00Z",
          author: "author1",
        },
        {
          patchId: "234" as PatchId,
          patch: [{ op: "add", path: [entry, "alt"], value: "An example" }],
          createdAt: "2021-01-02T00:00:00Z",
          author: "author1",
        },
      ],
    );
    const serialized = patchSet.serialize();
    // The alt write nests inside the patch set the upload created, because the
    // entry cannot be published without the entry existing. What matters is
    // that it is the ENTRY, not the module: a second entry stays separate.
    expect(serialized.map((set) => set.patchPath)).toEqual([[entry]]);
    expect(serialized[0].patches.map((patch) => patch.patchId)).toEqual([
      "234",
      "123",
    ]);
  });

  test("imageset: two entries are two patch sets", async () => {
    const a = "/public/val/images/a_11111.png";
    const b = "/public/val/images/b_22222.png";
    const patchSet = testPatchSet(
      "/content/media.val.ts" as ModuleFilePath,
      s.imageset({
        accept: "image/*",
        dir: "/public/val/images",
        alt: s.string().minLength(4),
      }),
      [
        {
          patchId: "123" as PatchId,
          patch: [{ op: "add", path: [a, "alt"], value: "Alt for A" }],
          createdAt: "2021-01-01T00:00:00Z",
          author: "author1",
        },
        {
          patchId: "234" as PatchId,
          patch: [{ op: "add", path: [b, "alt"], value: "Alt for B" }],
          createdAt: "2021-01-02T00:00:00Z",
          author: "author2",
        },
      ],
    );
    const serialized = patchSet.serialize();
    expect(serialized.map((set) => set.patchPath)).toEqual([
      [b, "alt"],
      [a, "alt"],
    ]);
    expect(serialized.map((set) => set.lastUpdatedBy)).toEqual([
      "author2",
      "author1",
    ]);
  });

  /**
   * A `move` names two places, and the two are classified separately.
   *
   * The destination here is an object key, so it is isolated — but the source
   * is an array item, and removing one shifts every later index, so that side
   * has to be the whole array. Taking `op.from` at face value because the
   * DESTINATION happened to be keyed would let a sibling of the moved item be
   * staged on its own, against indices the move has already changed.
   */
  test("move: an array source is grouped as the array, not the item", async () => {
    const patchSet = testPatchSet(
      "/content/page.val.ts" as ModuleFilePath,
      s.object({
        items: s.array(s.string()),
        featured: s.object({ value: s.string() }),
      }),
      [
        {
          patchId: "123" as PatchId,
          patch: [
            {
              op: "move",
              from: ["items", "0"],
              path: ["featured", "value"],
            },
          ],
          createdAt: "2021-01-01T00:00:00Z",
          author: "author1",
        },
      ],
    );
    const serialized = patchSet.serialize();
    // Newest first: the source was inserted after the destination.
    expect(serialized.map((set) => set.patchPath)).toEqual([
      ["items"],
      ["featured", "value"],
    ]);
  });

  /**
   * A `copy` depends on its source just as a `move` does.
   *
   * It does not write the source, but it READS it, so the value it produces
   * carries every pending edit to that source. Duplicating a record entry
   * (`useDuplicateRecordEntry`) is the copy that actually ships; with the
   * source ungrouped, staging the duplicate alone published a copy of a value
   * whose pending edit was left behind. `editWouldRestage` in `patchGroups`
   * already checks `from` for both ops.
   */
  test("copy: the source is grouped with the destination", async () => {
    const patchSet = testPatchSet(
      "/content/pages.val.ts" as ModuleFilePath,
      s.record(s.object({ title: s.string() })),
      [
        {
          patchId: "123" as PatchId,
          patch: [{ op: "add", path: ["A", "title"], value: "edited" }],
          createdAt: "2021-01-01T00:00:00Z",
          author: "author1",
        },
        {
          patchId: "234" as PatchId,
          patch: [{ op: "copy", from: ["A"], path: ["B"] }],
          createdAt: "2021-01-02T00:00:00Z",
          author: "author1",
        },
      ],
    );
    const serialized = patchSet.serialize();
    // The copy is inserted under its source as well as its destination, so the
    // edit to "A" is swallowed into the source's set along with it — the two
    // can no longer be staged apart.
    const setOfA = serialized.find((set) => set.patchPath[0] === "A");
    expect(setOfA?.patches.map((patch) => patch.patchId).sort()).toEqual([
      "123",
      "234",
    ]);
  });

  /**
   * A discriminated union resolves to EVERY variant's type at once, so a
   * source inside one can be an array here and an object there.
   *
   * Requiring a single unambiguous type grouped the move at the item, which is
   * wrong the moment the array variant is the live one: removing that item
   * shifts every later index. Any possible array parent widens to the array,
   * which is the safe direction.
   */
  test("move: an ambiguous union source widens to the array", async () => {
    const patchSet = testPatchSet(
      "/content/page.val.ts" as ModuleFilePath,
      s.object({
        block: s.discriminatedUnion(
          "type",
          s.object({ type: s.literal("list"), items: s.array(s.string()) }),
          s.object({
            type: s.literal("map"),
            items: s.object({ a: s.string() }),
          }),
        ),
        target: s.object({ value: s.string() }),
      }),
      [
        {
          patchId: "123" as PatchId,
          patch: [
            {
              op: "move",
              from: ["block", "items", "0"],
              path: ["target", "value"],
            },
          ],
          createdAt: "2021-01-01T00:00:00Z",
          author: "author1",
        },
      ],
    );
    const serialized = patchSet.serialize();
    expect(serialized.map((set) => set.patchPath)).toEqual([
      ["block", "items"],
      ["target", "value"],
    ]);
  });

  /**
   * A path that no longer fits the schema still terminates the module.
   *
   * This is the case the throw was always for — a patch written against a
   * schema that has since changed — and it has to keep working: when we cannot
   * say what a change affects, the conservative answer is "all of it".
   */
  test("stale path: a primitive parent terminates the module", async () => {
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});
    try {
      const patchSet = testPatchSet(
        "/content/projects.val.ts" as ModuleFilePath,
        s.object({ title: s.string() }),
        [
          {
            patchId: "123" as PatchId,
            // `title` used to be an object; it is a string now.
            patch: [{ op: "add", path: ["title", "nb-NO"], value: "Tittel" }],
            createdAt: "2021-01-01T00:00:00Z",
            author: "author1",
          },
        ],
      );
      const serialized = patchSet.serialize();
      expect(serialized.map((set) => set.patchPath)).toEqual([[]]);
      expect(consoleError).toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
  // #endregion object

  // #region settings
  /**
   * A settings section is addressed like a record, so each field is its own
   * patch set.
   *
   * Both sections write `add` rather than `replace`, because the first write to
   * an absent section has to create it (see `useWriteAssistantSetting`) — and
   * `add` resolves the PARENT of its path, which for `["theme", "accent"]` is a
   * `settings` schema. That used to fall through to "cannot perform op on
   * non-array or non-record schema", which the caller catches by terminating
   * the WHOLE module into one patch set: two unrelated settings edits merged,
   * and the publish diff said "Settings" where `settingsChangeLabels` has a
   * name for the field.
   */
  test("settings: two fields in one section are two patch sets", async () => {
    const patchSet = testPatchSet(
      "/settings.val.ts" as ModuleFilePath,
      s.settings(),
      [
        {
          patchId: "123" as PatchId,
          patch: [{ op: "add", path: ["theme", "accent"], value: "#2563eb" }],
          createdAt: "2021-01-01T00:00:00Z",
          author: "author1",
        },
        {
          patchId: "234" as PatchId,
          patch: [{ op: "add", path: ["theme", "radius"], value: "tight" }],
          createdAt: "2021-01-02T00:00:00Z",
          author: "author1",
        },
      ],
    );
    // Newest first, as every other patch set is ordered.
    const serialized = patchSet.serialize();
    expect(serialized.map((set) => set.patchPath)).toEqual([
      ["theme", "radius"],
      ["theme", "accent"],
    ]);
    // The field's own schema type, not the section's: this is what the publish
    // diff reads to decide how to render the change. An enum reports `string`
    // alongside itself, because an enum's value IS a string — see
    // `schemaTypesOfPath`.
    expect(serialized.map((set) => set.schemaTypes)).toEqual([
      ["enum", "string"],
      ["color"],
    ]);
  });

  test("settings: the write that creates a section is its own patch set", async () => {
    // The first write to `{}`: one `add` at the section, carrying the other
    // fields as null. Its parent is the settings MODULE, which is also a
    // `settings` schema — so this exercises the same branch one level up.
    const patchSet = testPatchSet(
      "/settings.val.ts" as ModuleFilePath,
      s.settings(),
      [
        {
          patchId: "123" as PatchId,
          patch: [
            {
              op: "add",
              path: ["theme"],
              value: { accent: "#2563eb", radius: null, mode: null },
            },
          ],
          createdAt: "2021-01-01T00:00:00Z",
          author: "author1",
        },
      ],
    );
    const serialized = patchSet.serialize();
    expect(serialized.map((set) => set.patchPath)).toEqual([["theme"]]);
    expect(serialized[0].schemaTypes).toEqual(["settings"]);
  });

  test("settings: sections stay separate from each other", async () => {
    // The assistant and the theme are edited in different tabs and published
    // together; a reviewer has to see two changes, not one.
    const patchSet = testPatchSet(
      "/settings.val.ts" as ModuleFilePath,
      s.settings(),
      [
        {
          patchId: "123" as PatchId,
          patch: [{ op: "add", path: ["assistant", "tone"], value: "Formal." }],
          createdAt: "2021-01-01T00:00:00Z",
          author: "author1",
        },
        {
          patchId: "234" as PatchId,
          patch: [{ op: "add", path: ["theme", "accent"], value: "#2563eb" }],
          createdAt: "2021-01-02T00:00:00Z",
          author: "author2",
        },
      ],
    );
    const serialized = patchSet.serialize();
    expect(serialized.map((set) => set.patchPath)).toEqual([
      ["theme", "accent"],
      ["assistant", "tone"],
    ]);
    expect(serialized.map((set) => set.lastUpdatedBy)).toEqual([
      "author2",
      "author1",
    ]);
  });
  // #endregion settings
});

function testPatchSet(
  moduleFilePath: ModuleFilePath,
  schema: Schema<SelectorSource>,
  patches: TestData[],
  prev?: PatchSets,
) {
  const patchSet = prev || new PatchSets();
  for (const patch of patches) {
    patchSet.insert(
      moduleFilePath,
      schema["executeSerialize"](),
      patch.patch,
      patch.patchId,
      patch.createdAt,
      patch.author,
    );
  }
  return patchSet;
}

type TestData = {
  patchId: PatchId;
  patch: Patch;
  createdAt: string;
  author: string | null;
};
