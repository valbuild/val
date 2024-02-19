import {
  Internal,
  ModuleId,
  ModulePath,
  PatchId,
  SourcePath,
} from "@valbuild/core";
import { convertPatchErrors } from "./convertPatchErrors";

const moduleIds = ["/app/test", "/app/example"] as ModuleId[];
const patchIds = ["1707928555701", "1707928555702"] as PatchId[];
const modulePaths = ['1."test"', '1."example"'] as ModulePath[];
const sourcePaths = [
  `${moduleIds[0]}.${modulePaths[0]}`,
  `${moduleIds[1]}.${modulePaths[1]}`,
] as SourcePath[];

describe("convertPatchErrors", () => {
  test("todo", () => {
    console.log(
      JSON.stringify(
        convertPatchErrors(
          {
            [moduleIds[0]]: [
              {
                author: "1",
                created_at: new Date(parseInt(patchIds[0])).toISOString(),
                patch_id: patchIds[0],
                patch: [
                  {
                    op: "replace",
                    path: Internal.createPatchPath(modulePaths[0]),
                    value: "test",
                  },
                  {
                    op: "replace",
                    path: Internal.createPatchPath(modulePaths[1]),
                    value: "test2",
                  },
                  {
                    op: "file",
                    path: Internal.createPatchPath(modulePaths[0]),
                    filePath: "/app/test",
                    value: "test2",
                  },
                ],
              },
              {
                author: "2",
                created_at: new Date(parseInt(patchIds[0])).toISOString(),
                patch_id: patchIds[1],
                patch: [
                  {
                    op: "replace",
                    path: Internal.createPatchPath(modulePaths[0]),
                    value: "tst",
                  },
                ],
              },
            ],
          },
          {
            validationErrors: {
              [moduleIds[0]]: {
                errors: {
                  validation: {
                    [sourcePaths[0]]: [
                      {
                        message:
                          "Text length is 3 characters: must be between 10 and 100 characters",
                      },
                      {
                        message:
                          "Text is 'Hello': must correspond to pattern 'CMS|Test'",
                      },
                    ],
                  },
                },
              },
            },
            modules: {
              [moduleIds[0]]: {
                patches: {
                  applied: [patchIds[0]],
                  failed: [patchIds[1]],
                },
              },
            },
          },
          {
            "1": {
              id: "1",
              name: "Test",
            },
            "2": {
              id: "2",
              name: "Test2",
            },
          }
        ),
        null,
        2
      )
    );
  });
});
