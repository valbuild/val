import {
  Internal,
  Json,
  ModuleFilePath,
  SerializedSchema,
  ValModule,
  initVal,
} from "@valbuild/core";
import { SelectorSource } from "@valbuild/core/src/selector";
import { getKeysOf } from "./getKeysOf";

const { s, c } = initVal();

describe("getKeysOf", () => {
  test("find keysOf parent record", () => {
    const mod1 = c.define(
      "/path1.val.ts",
      s.record(
        s.object({
          name: s.string(),
        }),
      ),
      {
        test1: {
          name: "mod1",
        },
      },
    );
    const modules = [mod1, c.define("/path2.val.ts", s.keyOf(mod1), "test1")];
    const { schemas, sources } = getTestData(modules);
    const result = getKeysOf(
      schemas,
      sources,
      "/path1.val.ts" as ModuleFilePath,
    );
    expect(result).toEqual(["/path2.val.ts"]);
  });

  test("find keysOf record (child)", () => {
    const mod1 = c.define(
      "/path1.val.ts",
      s.record(
        s.object({
          name: s.string(),
        }),
      ),
      {
        test1: {
          name: "mod1",
        },
      },
    );
    const modules = [mod1, c.define("/path2.val.ts", s.keyOf(mod1), "test1")];
    const { schemas, sources } = getTestData(modules);
    const result = getKeysOf(
      schemas,
      sources,
      "/path1.val.ts" as ModuleFilePath,
      "test1",
    );
    expect(result).toEqual(["/path2.val.ts"]);
  });

  test("correct if no results on parent", () => {
    const mod1 = c.define(
      "/path1.val.ts",
      s.record(
        s.object({
          name: s.string(),
        }),
      ),
      {
        test1: {
          name: "mod1",
        },
      },
    );
    const mod3 = c.define(
      "/path3.val.ts",
      s.record(
        s.object({
          name: s.string(),
        }),
      ),
      {
        test1: {
          name: "mod1",
        },
      },
    );
    const modules = [
      mod1,
      c.define("/path2.val.ts", s.keyOf(mod1), "test1"),
      mod3,
    ];
    const { schemas, sources } = getTestData(modules);
    const result = getKeysOf(
      schemas,
      sources,
      "/path3.val.ts" as ModuleFilePath,
    );
    expect(result).toEqual([]);
  });

  test("correct if no matching child", () => {
    const mod1 = c.define(
      "/path1.val.ts",
      s.record(
        s.object({
          name: s.string(),
        }),
      ),
      {
        test1: {
          name: "mod1",
        },
        test2: {
          name: "mod1",
        },
      },
    );
    const modules = [mod1, c.define("/path2.val.ts", s.keyOf(mod1), "test1")];
    const { schemas, sources } = getTestData(modules);
    const result = getKeysOf(
      schemas,
      sources,
      "/path1.val.ts" as ModuleFilePath,
      "test2",
    );
    expect(result).toEqual([]);
  });

  test("correct if nested keyOf", () => {
    const mod1 = c.define(
      "/path1.val.ts",
      s.record(
        s.object({
          name: s.string(),
        }),
      ),
      {
        test1: {
          name: "mod1",
        },
        test2: {
          name: "mod1",
        },
      },
    );
    const modules = [
      mod1,
      c.define(
        "/path2.val.ts",
        s.object({
          level1: s.record(
            s.object({
              level2: s.array(
                s.union(
                  "type",
                  s.object({
                    type: s.literal("one"),
                    findThis: s.keyOf(mod1),
                  }),
                  s.object({
                    type: s.literal("two"),
                    doNotBreakHere: s.string(),
                  }),
                ),
              ),
            }),
          ),
        }),
        {
          level1: {
            record1: {
              level2: [
                {
                  type: "one",
                  findThis: "test1",
                },
              ],
            },
          },
        },
      ),
    ];
    const { schemas, sources } = getTestData(modules);
    const resultWithChild = getKeysOf(
      schemas,
      sources,
      "/path1.val.ts" as ModuleFilePath,
      "test1",
    );
    expect(resultWithChild).toEqual([
      '/path2.val.ts?p="level1"."record1"."level2".0."findThis"',
    ]);
    const resultWithParent = getKeysOf(
      schemas,
      sources,
      "/path1.val.ts" as ModuleFilePath,
    );
    expect(resultWithParent).toEqual([
      '/path2.val.ts?p="level1"."record1"."level2".0."findThis"',
    ]);
  });
});

function getTestData(valModules: ValModule<SelectorSource>[]) {
  const schemas: Record<ModuleFilePath, SerializedSchema> = {};
  const sources: Record<ModuleFilePath, Json> = {};
  for (const valModule of valModules) {
    const moduleFilePath = getModuleFilePath(valModule);
    schemas[moduleFilePath] = getSchema(valModule);
    sources[moduleFilePath] = getSource(valModule);
  }
  return { schemas, sources };
}

function getModuleFilePath(
  valModule: ValModule<SelectorSource>,
): ModuleFilePath {
  return Internal.getValPath(valModule) as unknown as ModuleFilePath;
}

function getSchema(valModule: ValModule<SelectorSource>): SerializedSchema {
  const schema = Internal.getSchema(valModule)?.serialize();
  if (!schema) {
    throw new Error("Schema not found");
  }
  return schema;
}

function getSource(valModule: ValModule<SelectorSource>): Json {
  const source = Internal.getSource(valModule);
  if (!source) {
    throw new Error("Source not found");
  }
  return source;
}
