import {
  Internal,
  ModuleFilePath,
  SelectorSource,
  SourcePath,
  ValModule,
  initVal,
} from "@valbuild/core";
import { getNavPathFromAll } from "./getNavPath";

const { c, s } = initVal();
const module = c.define(
  "/app/test.val.ts",
  s.object({
    arrayOfStrings: s.array(s.string()),
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
    // NOTE: this behavior might change: maybe array of strings should not default to be shown
    expect(
      testNavPath('/app/test.val.ts?p="arrayOfStrings"', module),
    ).toStrictEqual("/app/test.val.ts");

    expect(
      testNavPath('/app/test.val.ts?p="arrayOfStrings".0', module),
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
