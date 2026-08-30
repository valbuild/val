import {
  Internal,
  ModuleFilePath,
  SelectorSource,
  SourcePath,
  ValModule,
  initVal,
} from "@valbuild/core";
import { getNavPathFromAll, resolveNavPath } from "./getNavPath";

const { c, s } = initVal();
const module = c.define(
  "/app/test.val.ts",
  s.object({
    arrayOfStrings: s.array(s.string()),
    arrayOfInlineStrings: s.array(s.string().render({ as: "inline" })),
    arrayOfInlineObjects: s.array(
      s
        .object({
          title: s.string(),
          sections: s.array(
            s.object({ heading: s.string() }).render({ as: "inline" }),
          ),
        })
        .render({ as: "inline" }),
    ),
    recordOfInlineObjects: s.record(
      s.object({ title: s.string() }).render({ as: "inline" }),
    ),
    objectOfRecord: s.object({
      recordA: s.record(
        s.object({
          field201: s.string(),
        }),
      ),
    }),
    arrayOfObjects: s.array(
      s.object({
        stringInsideArray: s.string(),
        subArrayOfObjects: s.array(
          s.object({
            string1: s.string(),
            string2: s.string(),
          }),
        ),
      }),
    ),
  }),
  {
    arrayOfStrings: ["a", "b", "c"],
    arrayOfInlineStrings: ["a", "b"],
    arrayOfInlineObjects: [
      { title: "a", sections: [{ heading: "h1" }, { heading: "h2" }] },
    ],
    recordOfInlineObjects: {
      a: { title: "a" },
    },
    objectOfRecord: {
      recordA: {
        a: { field201: "a" },
        b: { field201: "b" },
      },
    },
    arrayOfObjects: [
      {
        stringInsideArray: "a",
        subArrayOfObjects: [
          { string1: "a", string2: "b" },
          { string1: "c", string2: "d" },
        ],
      },
      {
        stringInsideArray: "b",
        subArrayOfObjects: [
          { string1: "a", string2: "b" },
          { string1: "c", string2: "d" },
        ],
      },
    ],
  },
);

describe("getNavPath", () => {
  test("array of string", () => {
    // Strings in arrays used to be inlined implicitly; inlining is now opt-in
    // via `.render({ as: "inline" })`, so a plain string item is a nav stop.
    expect(
      testNavPath('/app/test.val.ts?p="arrayOfStrings"', module),
    ).toStrictEqual("/app/test.val.ts");

    expect(
      testNavPath('/app/test.val.ts?p="arrayOfStrings".0', module),
    ).toStrictEqual('/app/test.val.ts?p="arrayOfStrings".0');
  });

  test("array of inline strings", () => {
    expect(
      testNavPath('/app/test.val.ts?p="arrayOfInlineStrings".0', module),
    ).toStrictEqual("/app/test.val.ts");
  });

  test("array of inline objects", () => {
    // The whole subtree of an inline item is edited in the parent's list, so
    // every path inside it resolves up to the nearest non-inline ancestor —
    // here the module root, since the nested sections are inline too.
    expect(
      testNavPath('/app/test.val.ts?p="arrayOfInlineObjects".0', module),
    ).toStrictEqual("/app/test.val.ts");
    expect(
      testNavPath(
        '/app/test.val.ts?p="arrayOfInlineObjects".0."title"',
        module,
      ),
    ).toStrictEqual("/app/test.val.ts");
    expect(
      testNavPath(
        '/app/test.val.ts?p="arrayOfInlineObjects".0."sections".0."heading"',
        module,
      ),
    ).toStrictEqual("/app/test.val.ts");
  });

  test("record of inline objects", () => {
    expect(
      testNavPath('/app/test.val.ts?p="recordOfInlineObjects"."a"', module),
    ).toStrictEqual("/app/test.val.ts");
    expect(
      testNavPath(
        '/app/test.val.ts?p="recordOfInlineObjects"."a"."title"',
        module,
      ),
    ).toStrictEqual("/app/test.val.ts");
  });

  test("object of record", () => {
    expect(
      testNavPath('/app/test.val.ts?p="objectOfRecord"', module),
    ).toStrictEqual("/app/test.val.ts");
    expect(
      testNavPath('/app/test.val.ts?p="objectOfRecord"."recordA"', module),
    ).toStrictEqual("/app/test.val.ts");
    expect(
      testNavPath('/app/test.val.ts?p="objectOfRecord"."recordA"."a"', module),
    ).toStrictEqual('/app/test.val.ts?p="objectOfRecord"."recordA"."a"');
    expect(
      testNavPath(
        '/app/test.val.ts?p="objectOfRecord"."recordA"."a"."field201"',
        module,
      ),
    ).toStrictEqual('/app/test.val.ts?p="objectOfRecord"."recordA"."a"');
  });

  test("array of objects", () => {
    expect(
      testNavPath('/app/test.val.ts?p="arrayOfObjects"', module),
    ).toStrictEqual("/app/test.val.ts");
    expect(
      testNavPath('/app/test.val.ts?p="arrayOfObjects".0', module),
    ).toStrictEqual('/app/test.val.ts?p="arrayOfObjects".0');
    expect(
      testNavPath(
        '/app/test.val.ts?p="arrayOfObjects".0."subArrayOfObjects"',
        module,
      ),
    ).toStrictEqual('/app/test.val.ts?p="arrayOfObjects".0');
    expect(
      testNavPath(
        '/app/test.val.ts?p="arrayOfObjects".0."subArrayOfObjects".0',
        module,
      ),
    ).toStrictEqual(
      '/app/test.val.ts?p="arrayOfObjects".0."subArrayOfObjects".0',
    );
    expect(
      testNavPath(
        '/app/test.val.ts?p="arrayOfObjects".0."subArrayOfObjects".0."string1"',
        module,
      ),
    ).toStrictEqual(
      '/app/test.val.ts?p="arrayOfObjects".0."subArrayOfObjects".0',
    );
  });
});

/**
 * Why a path did not resolve, told apart.
 *
 * `getNavPathFromAll` answers `null` to all three of these, which is all most
 * callers can use. The canvas cannot: a click on the running page that opens
 * nothing has to say something, and "still loading", "that file is gone" and
 * "the page is tagged with a path that no longer exists" are three different
 * things to say and three different things to do about them.
 */
describe("resolveNavPath", () => {
  const source = Internal.getSource(module);
  const moduleFilePath = Internal.getValPath(
    module,
  ) as unknown as ModuleFilePath;
  const schema = Internal.getSchema(module)!["executeSerialize"]();
  const sources = { [moduleFilePath]: source };
  const schemas = { [moduleFilePath]: schema };

  test("resolves like getNavPathFromAll does", () => {
    expect(
      resolveNavPath(
        '/app/test.val.ts?p="arrayOfObjects".0."stringInsideArray"' as SourcePath,
        sources,
        schemas,
      ),
    ).toEqual({
      status: "resolved",
      path: '/app/test.val.ts?p="arrayOfObjects".0',
    });
  });

  test("says when the schemas have not arrived", () => {
    expect(
      resolveNavPath(
        '/app/test.val.ts?p="arrayOfStrings".0' as SourcePath,
        sources,
        undefined,
      ),
    ).toEqual({ status: "schemas-not-loaded" });
  });

  test("says when the module behind the path is not loaded", () => {
    expect(
      resolveNavPath(
        '/app/gone.val.ts?p="title"' as SourcePath,
        sources,
        schemas,
      ),
    ).toEqual({
      status: "module-not-loaded",
      moduleFilePath: "/app/gone.val.ts",
    });
  });

  test("says when the path does not point at anything in the module", () => {
    const resolution = resolveNavPath(
      '/app/test.val.ts?p="noSuchField"."deeper"' as SourcePath,
      sources,
      schemas,
    );
    expect(resolution.status).toBe("unresolvable");
    // The reason travels: it is the only thing that says WHERE the page and the
    // schema disagree, and it ends up in the details line of the message.
    if (resolution.status === "unresolvable") {
      expect(resolution.moduleFilePath).toBe("/app/test.val.ts");
      expect(resolution.reason.length).toBeGreaterThan(0);
    }
  });
});

function testNavPath(
  path: string,
  module: ValModule<SelectorSource>,
): string | null {
  const source = Internal.getSource(module);
  const moduleFilePath = Internal.getValPath(
    module,
  ) as unknown as ModuleFilePath;
  const schema = Internal.getSchema(module)!["executeSerialize"]();
  const navPath = getNavPathFromAll(
    path as SourcePath | ModuleFilePath,
    {
      [moduleFilePath]: source,
    },
    {
      [moduleFilePath]: schema,
    },
  );
  return navPath;
}
