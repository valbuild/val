import { initVal, ModuleFilePath } from "@valbuild/core";
import { getPatchedSourcePaths } from "./getPatchedSourcePaths";

const { s } = initVal();
describe("getPatchedSourcePaths", () => {
  test("todo", () => {
    console.log(
      getPatchedSourcePaths(
        "/app/test.val.ts" as ModuleFilePath,
        s.object({ array: s.array(s.object({ field1: s.string() })) }),
        [
          [
            {
              op: "replace",
              path: ["array", "1", "object", "field1"],
              value: "value",
            },
            {
              op: "replace",
              path: ["array", "1"],
              value: "value",
            },
          ],
        ],
      ),
    );
  });
});
