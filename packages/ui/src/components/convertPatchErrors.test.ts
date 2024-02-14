import {
  ApiGetPatchResponse,
  Internal,
  ModuleId,
  ModulePath,
  PatchId,
  SourcePath,
  ValidationErrors,
} from "@valbuild/core";
import { convertPatchErrors } from "./convertPatchErrors";

const moduleIds = ["/app/test", "/app/example"] as ModuleId[];
const patchIds = ["1707928555701", "1707928555702"] as PatchId[];
const sourcePaths = ['1."test"', '1."example"'] as ModulePath[];

describe("convertPatchErrors", () => {
  test("todo", () => {
    console.log(
      JSON.stringify(
        convertPatchErrors(
          {
            [moduleIds[0]]: [
              {
                created_at: new Date(parseInt(patchIds[0])).toISOString(),
                patch_id: patchIds[0],
                patch: [
                  {
                    op: "replace",
                    path: Internal.createPatchPath(sourcePaths[0]),
                    value: "test",
                  },
                  {
                    op: "replace",
                    path: Internal.createPatchPath(sourcePaths[1]),
                    value: "test2",
                  },
                  {
                    op: "file",
                    path: Internal.createPatchPath(sourcePaths[0]),
                    filePath: "/app/test",
                    value: "test2",
                  },
                ],
              },
              {
                created_at: new Date(parseInt(patchIds[0])).toISOString(),
                patch_id: patchIds[1],
                patch: [
                  {
                    op: "replace",
                    path: Internal.createPatchPath(sourcePaths[0]),
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
          }
        ),
        null,
        2
      )
    );
  });
});
