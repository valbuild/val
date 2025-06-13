import {
  initVal,
  Internal,
  ModuleFilePath,
  SelectorSource,
  SerializedSchema,
  ValModule,
} from "@valbuild/core";
import { getDependentModuleFiles } from "./getDependentModuleFiles";

describe("getDependentModuleFiles", () => {
  test("basics", () => {
    const { c, s } = initVal();
    const module1 = c.define(
      "/module1.val.ts",
      s.record(
        s.object({
          name: s.string(),
        }),
      ),
      {
        test1: { name: "testname1" },
      },
    );
    const module2 = c.define(
      "/module2.val.ts",
      s.object({
        author: s.keyOf(module1),
      }),
      {
        author: "test1",
      },
    );
    const schemas = convert([module1, module2]);
    expect(
      getDependentModuleFiles(getModuleFilePath(module1), schemas),
    ).toStrictEqual([getModuleFilePath(module2)]);
  });

  test("union", () => {
    const { c, s } = initVal();
    const module1 = c.define(
      "/module1.val.ts",
      s.record(
        s.object({
          name: s.string(),
        }),
      ),
      {
        test1: { name: "testname1" },
      },
    );
    const module2 = c.define(
      "/module2.val.ts",
      s.record(
        s.object({
          status: s.string(),
        }),
      ),
      {
        test2: { status: "teststatus" },
      },
    );
    const module3 = c.define(
      "/module3.val.ts",
      s.object({
        author: s.keyOf(module1),
        status: s.keyOf(module2),
      }),
      {
        author: "test1",
        status: "test2",
      },
    );
    const module4 = c.define(
      "/module4.val.ts",
      s.array(
        s.object({
          value: s.union(
            "type",
            s.object({
              type: s.literal("type1"),
              value: s.keyOf(module1),
            }),
            s.object({
              type: s.literal("type2"),
              num: s.number(),
            }),
          ),
        }),
      ),
      [
        {
          value: { type: "type1", value: "test1" },
        },
        {
          value: { type: "type2", num: 1 },
        },
      ],
    );
    const schemas = convert([module1, module2, module3, module4]);
    expect(
      getDependentModuleFiles(getModuleFilePath(module1), schemas),
    ).toStrictEqual([getModuleFilePath(module3), getModuleFilePath(module4)]);
    expect(
      getDependentModuleFiles(getModuleFilePath(module2), schemas),
    ).toStrictEqual([getModuleFilePath(module3)]);
    expect(
      getDependentModuleFiles(getModuleFilePath(module3), schemas),
    ).toStrictEqual([]);
    expect(
      getDependentModuleFiles(getModuleFilePath(module4), schemas),
    ).toStrictEqual([]);
  });
});

function getModuleFilePath(module: ValModule<SelectorSource>): ModuleFilePath {
  return Internal.getValPath(module) as unknown as ModuleFilePath;
}

function convert(
  input: ValModule<SelectorSource>[],
): Record<ModuleFilePath, SerializedSchema> {
  const output: Record<ModuleFilePath, SerializedSchema> = {};
  for (const valModule of input) {
    output[getModuleFilePath(valModule)] =
      Internal.getSchema(valModule)!["executeSerialize"]();
  }
  return output;
}
