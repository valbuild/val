import {
  Internal,
  Json,
  ModuleFilePath,
  SerializedSchema,
  ValModule,
  initVal,
} from "@valbuild/core";
import { SelectorSource } from "@valbuild/core";
import { getRouteReferences } from "./getRouteReferences";

const { s, c } = initVal();

describe("getRouteReferences", () => {
  test("find simple route reference", () => {
    const routerMod = c.define(
      "/routes.val.ts",
      s.record(
        s.object({
          title: s.string(),
        })
      ),
      {
        "/home": { title: "Home" },
        "/about": { title: "About" },
      }
    );
    const modules = [
      routerMod,
      c.define(
        "/content.val.ts",
        s.object({
          link: s.route(),
        }),
        {
          link: "/home",
        }
      ),
    ];
    const { schemas, sources } = getTestData(modules);
    const result = getRouteReferences(schemas, sources, "/home");
    expect(result).toEqual(['/content.val.ts?p="link"']);
  });

  test("find multiple route references to same route", () => {
    const routerMod = c.define(
      "/routes.val.ts",
      s.record(
        s.object({
          title: s.string(),
        })
      ),
      {
        "/home": { title: "Home" },
        "/about": { title: "About" },
      }
    );
    const modules = [
      routerMod,
      c.define(
        "/content1.val.ts",
        s.object({
          link: s.route(),
        }),
        {
          link: "/home",
        }
      ),
      c.define(
        "/content2.val.ts",
        s.object({
          mainLink: s.route(),
        }),
        {
          mainLink: "/home",
        }
      ),
    ];
    const { schemas, sources } = getTestData(modules);
    const result = getRouteReferences(schemas, sources, "/home");
    expect(result).toEqual([
      '/content1.val.ts?p="link"',
      '/content2.val.ts?p="mainLink"',
    ]);
  });

  test("no results when route not referenced", () => {
    const routerMod = c.define(
      "/routes.val.ts",
      s.record(
        s.object({
          title: s.string(),
        })
      ),
      {
        "/home": { title: "Home" },
        "/about": { title: "About" },
      }
    );
    const modules = [
      routerMod,
      c.define(
        "/content.val.ts",
        s.object({
          link: s.route(),
        }),
        {
          link: "/about",
        }
      ),
    ];
    const { schemas, sources } = getTestData(modules);
    const result = getRouteReferences(schemas, sources, "/home");
    expect(result).toEqual([]);
  });

  test("find route reference in array", () => {
    const routerMod = c.define(
      "/routes.val.ts",
      s.record(
        s.object({
          title: s.string(),
        })
      ),
      {
        "/home": { title: "Home" },
        "/about": { title: "About" },
      }
    );
    const modules = [
      routerMod,
      c.define(
        "/content.val.ts",
        s.object({
          links: s.array(s.route()),
        }),
        {
          links: ["/home", "/about", "/home"],
        }
      ),
    ];
    const { schemas, sources } = getTestData(modules);
    const result = getRouteReferences(schemas, sources, "/home");
    // Should find both occurrences of /home
    expect(result).toEqual([
      '/content.val.ts?p="links".0',
      '/content.val.ts?p="links".2',
    ]);
  });

  test("find route reference in nested object", () => {
    const routerMod = c.define(
      "/routes.val.ts",
      s.record(
        s.object({
          title: s.string(),
        })
      ),
      {
        "/home": { title: "Home" },
        "/about": { title: "About" },
      }
    );
    const modules = [
      routerMod,
      c.define(
        "/content.val.ts",
        s.object({
          nav: s.object({
            primary: s.route(),
            secondary: s.route(),
          }),
        }),
        {
          nav: {
            primary: "/home",
            secondary: "/about",
          },
        }
      ),
    ];
    const { schemas, sources } = getTestData(modules);
    const result = getRouteReferences(schemas, sources, "/home");
    expect(result).toEqual(['/content.val.ts?p="nav"."primary"']);
  });

  test("find route reference in record", () => {
    const routerMod = c.define(
      "/routes.val.ts",
      s.record(
        s.object({
          title: s.string(),
        })
      ),
      {
        "/home": { title: "Home" },
        "/about": { title: "About" },
      }
    );
    const modules = [
      routerMod,
      c.define(
        "/content.val.ts",
        s.record(
          s.object({
            link: s.route(),
          })
        ),
        {
          item1: { link: "/home" },
          item2: { link: "/about" },
        }
      ),
    ];
    const { schemas, sources } = getTestData(modules);
    const result = getRouteReferences(schemas, sources, "/home");
    expect(result).toEqual(['/content.val.ts?p="item1"."link"']);
  });

  test("find route reference in union", () => {
    const routerMod = c.define(
      "/routes.val.ts",
      s.record(
        s.object({
          title: s.string(),
        })
      ),
      {
        "/home": { title: "Home" },
        "/about": { title: "About" },
      }
    );
    const modules = [
      routerMod,
      c.define(
        "/content.val.ts",
        s.object({
          items: s.array(
            s.union(
              "type",
              s.object({
                type: s.literal("link"),
                href: s.route(),
              }),
              s.object({
                type: s.literal("text"),
                content: s.string(),
              })
            )
          ),
        }),
        {
          items: [
            { type: "link", href: "/home" },
            { type: "text", content: "Hello" },
            { type: "link", href: "/about" },
          ],
        }
      ),
    ];
    const { schemas, sources } = getTestData(modules);
    const result = getRouteReferences(schemas, sources, "/home");
    expect(result).toEqual(['/content.val.ts?p="items".0."href"']);
  });

  test("find deeply nested route reference", () => {
    const routerMod = c.define(
      "/routes.val.ts",
      s.record(
        s.object({
          title: s.string(),
        })
      ),
      {
        "/home": { title: "Home" },
      }
    );
    const modules = [
      routerMod,
      c.define(
        "/content.val.ts",
        s.object({
          level1: s.record(
            s.object({
              level2: s.array(
                s.object({
                  level3: s.route(),
                })
              ),
            })
          ),
        }),
        {
          level1: {
            record1: {
              level2: [{ level3: "/home" }, { level3: "/home" }],
            },
          },
        }
      ),
    ];
    const { schemas, sources } = getTestData(modules);
    const result = getRouteReferences(schemas, sources, "/home");
    expect(result).toEqual([
      '/content.val.ts?p="level1"."record1"."level2".0."level3"',
      '/content.val.ts?p="level1"."record1"."level2".1."level3"',
    ]);
  });

  test("does not find route references in other schema types", () => {
    const modules = [
      c.define(
        "/content.val.ts",
        s.object({
          // Regular string that happens to look like a route
          notARoute: s.string(),
        }),
        {
          notARoute: "/home",
        }
      ),
    ];
    const { schemas, sources } = getTestData(modules);
    const result = getRouteReferences(schemas, sources, "/home");
    expect(result).toEqual([]);
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
  valModule: ValModule<SelectorSource>
): ModuleFilePath {
  return Internal.getValPath(valModule) as unknown as ModuleFilePath;
}

function getSchema(valModule: ValModule<SelectorSource>): SerializedSchema {
  const schema = Internal.getSchema(valModule)?.["executeSerialize"]();
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
