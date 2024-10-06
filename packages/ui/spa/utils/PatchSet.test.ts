import {
  initVal,
  Json,
  ModuleFilePath,
  PatchId,
  Schema,
  SelectorSource,
} from "@valbuild/core";
import { Patch } from "@valbuild/core/patch";
import { PatchSets } from "./PatchSet";

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
        },
      ],
    );
    const expected = {
      "/content/projects.val.ts": {
        "/Project A/title": ["123"],
        "/Project A/description": ["234"],
      },
    };
    expect(patchSet.serialize()).toEqual(expected);
    expect(PatchSets.from(patchSet.serialize()).serialize()).toEqual(expected);
  });

  test("basic record replace", async () => {
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
        },
      ],
    );
    const expected = {
      "/content/projects.val.ts": {
        "/Project A/title": ["123"],
        "/Project A/description": ["234"],
        "/Project_B": ["456", "567"],
      },
    };
    expect(patchSet.serialize()).toEqual(expected);
    expect(PatchSets.from(patchSet.serialize()).serialize()).toEqual(expected);
  });

  test("basic array replace", async () => {
    const patchSet = testPatchSet(
      "/content/projects.val.ts" as ModuleFilePath,
      {
        sections: [
          {
            title: "Title",
            description: "Description",
          },
        ],
      },
      s.object({
        sections: s.array(
          s.object({ title: s.string(), description: s.string() }),
        ),
      }),
      [
        {
          patchId: "123" as PatchId,
          patch: [
            {
              op: "replace",
              path: ["sections", "0", "title"],
              value: "New Title",
            },
          ],
        },
        {
          patchId: "234" as PatchId,
          patch: [
            {
              op: "replace",
              path: ["sections", "0", "description"],
              value: "New Description",
            },
          ],
        },
      ],
    );
    const expected = {
      "/content/projects.val.ts": {
        "/sections/0/title": ["123"],
        "/sections/0/description": ["234"],
      },
    };
    expect(patchSet.serialize()).toEqual(expected);
    expect(PatchSets.from(patchSet.serialize()).serialize()).toEqual(expected);
  });

  test("array add", async () => {
    const patchSet = testPatchSet(
      "/content/projects.val.ts" as ModuleFilePath,
      {
        sections: [
          {
            title: "Title",
            description: "Description",
          },
        ],
      },
      s.object({
        sections: s.array(
          s.object({ title: s.string(), description: s.string() }),
        ),
      }),
      [
        {
          patchId: "123" as PatchId,
          patch: [
            {
              op: "replace",
              path: ["sections", "0", "title"],
              value: "New Title",
            },
          ],
        },
        {
          patchId: "234" as PatchId,
          patch: [
            {
              op: "replace",
              path: ["sections", "0", "description"],
              value: "New Description",
            },
          ],
        },
        {
          patchId: "456" as PatchId,
          patch: [
            {
              op: "add",
              path: ["sections", "0"],
              value: {
                title: "Title",
                description: "Description",
              },
            },
          ],
        },
      ],
    );
    const expected = {
      "/content/projects.val.ts": {
        "/sections": ["123", "234", "456"],
      },
    };
    expect(patchSet.serialize()).toEqual(expected);
    expect(PatchSets.from(patchSet.serialize()).serialize()).toEqual(expected);
  });

  test("no patch sets", async () => {
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
        },
        {
          patchId: "678" as PatchId,
          patch: [
            {
              op: "replace",
              path: [],
              value: {},
            },
          ],
        },
      ],
    );
    const expected = {
      "/content/projects.val.ts": ["123", "234", "456", "567", "678"],
    };
    expect(patchSet.serialize()).toEqual(expected);
    expect(PatchSets.from(patchSet.serialize()).serialize()).toEqual(expected);
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
      );
    }
  }
  return patchSet;
}
type TestData = {
  patchId: PatchId;
  patch: Patch;
};
