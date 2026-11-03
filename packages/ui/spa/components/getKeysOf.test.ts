import {
  Internal,
  ModuleFilePath,
  SerializedSchema,
  Source,
  ValModule,
  initVal,
} from "@valbuild/core";
import { getKeysOf, keyOfScanScope } from "./getKeysOf";

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
                s.discriminatedUnion(
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

describe("keyOfScanScope", () => {
  /**
   * The scan walks only what can hold a reference: a page pointing at a record
   * and three libraries of 10,000 files walked all 30,000 files on every
   * keystroke, for a `keyOf` none of them could contain.
   */
  test("leaves out every module whose schema has no keyOf to the parent", () => {
    const posts = c.define(
      "/posts.val.ts",
      s.record(s.object({ title: s.string() })),
      { a: { title: "A" } },
    );
    const images = c.define(
      "/images.val.ts",
      s.imagedir("/public/val/images", {}),
      {},
    );
    const page = c.define(
      "/page.val.ts",
      s.object({
        sections: s.array(
          s.object({ post: s.keyOf(posts), hero: s.image(images) }),
        ),
      }),
      { sections: [] },
    );
    const other = c.define("/other.val.ts", s.keyOf(page), "sections");
    const { schemas } = getTestData([posts, images, page, other]);

    expect(
      Object.keys(keyOfScanScope(schemas, "/posts.val.ts" as ModuleFilePath)),
    ).toEqual(["/page.val.ts"]);
    expect(
      Object.keys(keyOfScanScope(schemas, "/page.val.ts" as ModuleFilePath)),
    ).toEqual(["/other.val.ts"]);
    expect(
      Object.keys(keyOfScanScope(schemas, "/images.val.ts" as ModuleFilePath)),
    ).toEqual([]);
  });

  test("finds the same references as a walk of everything", () => {
    const posts = c.define(
      "/posts.val.ts",
      s.record(s.object({ title: s.string() })),
      { a: { title: "A" }, b: { title: "B" } },
    );
    const page = c.define(
      "/page.val.ts",
      s.object({ list: s.array(s.object({ post: s.keyOf(posts) })) }),
      { list: [{ post: "a" }, { post: "b" }, { post: "a" }] },
    );
    const { schemas, sources } = getTestData([posts, page]);

    expect(
      getKeysOf(schemas, sources, "/posts.val.ts" as ModuleFilePath, "a"),
    ).toEqual([
      '/page.val.ts?p="list".0."post"',
      '/page.val.ts?p="list".2."post"',
    ]);
  });
});

function getTestData(valModules: ValModule<Source>[]) {
  const schemas: Record<ModuleFilePath, SerializedSchema> = {};
  const sources: Record<ModuleFilePath, Source> = {};
  for (const valModule of valModules) {
    const moduleFilePath = getModuleFilePath(valModule);
    schemas[moduleFilePath] = getSchema(valModule);
    sources[moduleFilePath] = getSource(valModule);
  }
  return { schemas, sources };
}

function getModuleFilePath(valModule: ValModule<Source>): ModuleFilePath {
  return Internal.getValPath(valModule) as unknown as ModuleFilePath;
}

function getSchema(valModule: ValModule<Source>): SerializedSchema {
  const schema = Internal.getSchema(valModule)?.["executeSerialize"]();
  if (!schema) {
    throw new Error("Schema not found");
  }
  return schema;
}

function getSource(valModule: ValModule<Source>): Source {
  const source = Internal.getSource(valModule);
  if (!source) {
    throw new Error("Source not found");
  }
  return source;
}
