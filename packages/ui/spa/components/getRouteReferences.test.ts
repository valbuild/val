import {
  Internal,
  ModuleFilePath,
  SerializedSchema,
  ValModule,
  Source,
  initVal,
} from "@valbuild/core";
import {
  buildRouteReferenceIndex,
  getRouteReferences,
  referencesTo,
} from "./getRouteReferences";

const { s, c } = initVal();

describe("getRouteReferences", () => {
  test("find simple route reference", () => {
    const routerMod = c.define(
      "/routes.val.ts",
      s.record(
        s.object({
          title: s.string(),
        }),
      ),
      {
        "/home": { title: "Home" },
        "/about": { title: "About" },
      },
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
        },
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
        }),
      ),
      {
        "/home": { title: "Home" },
        "/about": { title: "About" },
      },
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
        },
      ),
      c.define(
        "/content2.val.ts",
        s.object({
          mainLink: s.route(),
        }),
        {
          mainLink: "/home",
        },
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
        }),
      ),
      {
        "/home": { title: "Home" },
        "/about": { title: "About" },
      },
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
        },
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
        }),
      ),
      {
        "/home": { title: "Home" },
        "/about": { title: "About" },
      },
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
        },
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
        }),
      ),
      {
        "/home": { title: "Home" },
        "/about": { title: "About" },
      },
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
        },
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
        }),
      ),
      {
        "/home": { title: "Home" },
        "/about": { title: "About" },
      },
    );
    const modules = [
      routerMod,
      c.define(
        "/content.val.ts",
        s.record(
          s.object({
            link: s.route(),
          }),
        ),
        {
          item1: { link: "/home" },
          item2: { link: "/about" },
        },
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
        }),
      ),
      {
        "/home": { title: "Home" },
        "/about": { title: "About" },
      },
    );
    const modules = [
      routerMod,
      c.define(
        "/content.val.ts",
        s.object({
          items: s.array(
            s.discriminatedUnion(
              "type",
              s.object({
                type: s.literal("link"),
                href: s.route(),
              }),
              s.object({
                type: s.literal("text"),
                content: s.string(),
              }),
            ),
          ),
        }),
        {
          items: [
            { type: "link", href: "/home" },
            { type: "text", content: "Hello" },
            { type: "link", href: "/about" },
          ],
        },
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
        }),
      ),
      {
        "/home": { title: "Home" },
      },
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
                }),
              ),
            }),
          ),
        }),
        {
          level1: {
            record1: {
              level2: [{ level3: "/home" }, { level3: "/home" }],
            },
          },
        },
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
        },
      ),
    ];
    const { schemas, sources } = getTestData(modules);
    const result = getRouteReferences(schemas, sources, "/home");
    expect(result).toEqual([]);
  });

  /**
   * A module whose SCHEMA has no route field in it cannot hold a referrer, so
   * there is nothing in its source to find. Skipping it is worth doing because
   * of the asymmetry: the test is a walk over the schema, which is small and
   * the same shape for every project, while the walk it replaces is over the
   * source, which is the part that grows. On a real project most modules are
   * content with no route field anywhere, and this runs once per route key.
   */
  test("does not even look at the source of a module with no route in its schema", () => {
    const modules = [
      c.define("/routes.val.ts", s.record(s.object({ title: s.string() })), {
        "/home": { title: "Home" },
      }),
      c.define("/content.val.ts", s.object({ link: s.route() }), {
        link: "/home",
      }),
      c.define(
        "/prose.val.ts",
        s.object({ title: s.string(), body: s.string() }),
        { title: "About us", body: "/home is not a route here" },
      ),
    ];
    const { schemas, sources } = getTestData(modules);
    const read: string[] = [];
    const watched = new Proxy(sources, {
      get(target, key: string) {
        read.push(key);
        return target[key as ModuleFilePath];
      },
    });
    const result = getRouteReferences(schemas, watched, "/home");

    expect(result).toEqual(['/content.val.ts?p="link"']);
    // The router module holds route KEYS, not route fields, so it is skipped
    // too - a record of objects of strings has no `route` node in its schema.
    expect(read).toEqual(["/content.val.ts"]);
  });
});

/**
 * One index instead of one scan per URL.
 *
 * The external pages dialog asks about every URL it shows, and asking N times
 * is N traversals of the same tree to compare against a different string each
 * time - reaching the leaves is the cost, comparing them is not. Measured on 46
 * modules and 4.5 MB of source with 18 URLs: 4.02 ms as eighteen scans, 0.29 ms
 * as one index.
 *
 * It is also the only shape React allows. `useEagerRouteReferences` is a hook,
 * and a hook cannot be called once per item of a list whose length varies, so a
 * per-URL answer inside a component rendering N URLs is not merely slower - it
 * cannot be written.
 */
describe("buildRouteReferenceIndex", () => {
  const modules = [
    c.define("/routes.val.ts", s.record(s.object({ title: s.string() })), {
      "/home": { title: "Home" },
      "/about": { title: "About" },
    }),
    c.define(
      "/nav.val.ts",
      s.array(s.object({ label: s.string(), href: s.route() })),
      [
        { label: "Home", href: "/home" },
        { label: "About", href: "/about" },
        { label: "Home again", href: "/home" },
      ],
    ),
    c.define("/footer.val.ts", s.object({ link: s.route() }), {
      link: "/home",
    }),
    c.define("/prose.val.ts", s.object({ body: s.string() }), {
      body: "/home",
    }),
  ];

  test("buckets every route field by the value it holds", () => {
    const { schemas, sources } = getTestData(modules);
    const index = buildRouteReferenceIndex(schemas, sources);
    expect(referencesTo(index, "/home")).toEqual([
      '/nav.val.ts?p=0."href"',
      '/nav.val.ts?p=2."href"',
      '/footer.val.ts?p="link"',
    ]);
    expect(referencesTo(index, "/about")).toEqual(['/nav.val.ts?p=1."href"']);
  });

  test("a value nothing points at is an empty list, not undefined", () => {
    const { schemas, sources } = getTestData(modules);
    const index = buildRouteReferenceIndex(schemas, sources);
    expect(referencesTo(index, "/contact")).toEqual([]);
  });

  test("a string that merely LOOKS like a route is not one", () => {
    // `/prose.val.ts` holds "/home" in an `s.string()`. The schema is what
    // decides, which is the same reason its module is skipped entirely.
    const { schemas, sources } = getTestData(modules);
    const index = buildRouteReferenceIndex(schemas, sources);
    expect(referencesTo(index, "/home")).not.toContain(
      '/prose.val.ts?p="body"',
    );
  });

  test("agrees with scanning for each key separately", () => {
    const { schemas, sources } = getTestData(modules);
    const index = buildRouteReferenceIndex(schemas, sources);
    for (const key of ["/home", "/about", "/contact"]) {
      expect(referencesTo(index, key)).toEqual(
        getRouteReferences(schemas, sources, key),
      );
    }
  });

  test("is empty for a project with no route fields at all", () => {
    const { schemas, sources } = getTestData([
      c.define("/prose.val.ts", s.object({ body: s.string() }), {
        body: "/home",
      }),
    ]);
    expect(buildRouteReferenceIndex(schemas, sources).size).toBe(0);
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
