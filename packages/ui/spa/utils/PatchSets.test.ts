import {
  initVal,
  Json,
  ModuleFilePath,
  PatchId,
  Schema,
  SelectorSource,
} from "@valbuild/core";
import { Patch } from "@valbuild/core/patch";
import { PatchSets } from "./PatchSets";

const { s } = initVal();
describe("PatchSet", () => {
  test("basic replace", async () => {
    const patchSet = testPatchSet(
      "/content/projects.val.ts" as ModuleFilePath,
      {
        "Project A": {
          title: "Title",
          description: "Description",
        },
      },
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
            moduleFilePath: "/content/projects.val.ts",
            patchId: "234",
            author: "author1",
            createdAt: "2021-01-02T00:00:00Z",
            opType: "replace",
            schemaType: "record",
          },
        ],
        authors: ["author1"],
        opTypes: ["replace"],
        schemaType: "record",
        lastUpdated: "2021-01-02T00:00:00Z",
        lastUpdatedBy: "author1",
      },
      {
        moduleFilePath: "/content/projects.val.ts",
        patchPath: ["Project A", "title"],
        patches: [
          {
            moduleFilePath: "/content/projects.val.ts",
            patchId: "123",
            author: "author1",
            createdAt: "2021-01-01T00:00:00Z",
            opType: "replace",
            schemaType: "record",
          },
        ],
        authors: ["author1"],
        opTypes: ["replace"],
        schemaType: "record",
        lastUpdated: "2021-01-01T00:00:00Z",
        lastUpdatedBy: "author1",
      },
    ];
    expect(patchSet.serialize()).toEqual(expected);
  });

  test("basic replace", async () => {
    const patchSet = testPatchSet(
      "/content/projects.val.ts" as ModuleFilePath,
      {
        "Project A": {
          title: "Title",
          description: "Description",
        },
      },
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
          patchId: "123" as PatchId,
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
    const expected = [];
    console.log(JSON.stringify(patchSet.serialize(), null, 2));
    expect(patchSet.serialize()).toEqual(expected);
  });
});

function testPatchSet(
  moduleFilePath: ModuleFilePath,
  source: Json,
  schema: Schema<SelectorSource>,
  patches: TestData[],
) {
  const patchSet = new PatchSets();
  for (const patch of patches) {
    for (const op of patch.patch) {
      patchSet.insert(
        moduleFilePath,
        source,
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
