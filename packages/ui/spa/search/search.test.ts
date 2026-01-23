import {
  Internal,
  Json,
  ModuleFilePath,
  SerializedSchema,
  SelectorSource,
  ValModule,
  initVal,
} from "@valbuild/core";
import { createSearchIndex } from "./createSearchIndex";
import { search } from ".";

describe("search", () => {
  test("basics", () => {
    const { s, c } = initVal();
    const testVal = c.define(
      "/content/magic/mcguffin/test1.val.ts",
      s.record(s.object({ name: s.string() })),
      {
        unique: { name: "Name of Test" },
      }
    );
    const data = createTestDate([
      testVal,
      c.define(
        "/content/test2.val.ts",
        s.object({
          testString: s.string(),
          testNumber: s.number(),
          testArray: s.array(s.string()),
          testKeyOf: s.keyOf(testVal),
          testUnionString: s.union(s.literal("foo"), s.literal("bar")),
          testUnionObject: s.union(
            "type",
            s.object({ type: s.literal("foo"), value: s.string() }),
            s.object({ type: s.literal("bar"), value: s.number() })
          ),
          testRichText: s.richtext(),
          testImage: s.image(),
          testFile: s.file(),
          testDate: s.date(),
          testNullable: s.string().nullable(),
        }),
        {
          testString: "Hello world (inside string) content",
          testNumber: 42,
          testArray: ["foo", "bar"],
          testKeyOf: "unique",
          testUnionString: "foo",
          testUnionObject: { type: "foo", value: "bar" },
          testRichText: [
            {
              tag: "p",
              children: [
                "Hello world",
                {
                  tag: "span",
                  styles: ["bold"],
                  children: [" from within the richtext"],
                },
              ],
            },
          ],
          testDate: "2021-01-01",
          testFile: c.file("/public/val/content/testFile.pdf"),
          testImage: c.image("/public/val/content/imageOfPerson.jpg"),
          testNullable: null,
        }
      ),
    ]);

    const indices = createSearchIndex(data);
    // NOTE: we ignore order in this test since the order might change and this test is not supposed to test that
    // TODO: write a test that checks the order of the results
    // string:
    expect(search(indices, "world inside string").sort()).toEqual(
      ['/content/test2.val.ts?p="testString"'].sort()
    );
    // composite results of string and richtext:
    expect(search(indices, "world").sort()).toEqual(
      [
        '/content/test2.val.ts?p="testString"',
        '/content/test2.val.ts?p="testRichText"',
      ].sort()
    );
    // richtext
    expect(search(indices, "world within richtext").sort()).toEqual(
      ['/content/test2.val.ts?p="testRichText"'].sort()
    );
    // check that tags in richtext are not indexed:
    expect(search(indices, "span").sort()).toEqual([]);

    // number:
    expect(search(indices, "42").sort()).toEqual(
      ['/content/test2.val.ts?p="testNumber"'].sort()
    );
    // unions:
    expect(search(indices, "foo").sort()).toEqual(
      [
        '/content/test2.val.ts?p="testArray".0',
        '/content/test2.val.ts?p="testUnionString"',
        '/content/test2.val.ts?p="testUnionObject"."type"',
      ].sort()
    );
    // more tests on object unions:
    expect(search(indices, "bar").sort()).toEqual(
      [
        '/content/test2.val.ts?p="testArray".1',
        '/content/test2.val.ts?p="testUnionObject"."value"',
      ].sort()
    );
    // keyOf:
    expect(search(indices, "unique").sort()).toEqual(
      [
        '/content/magic/mcguffin/test1.val.ts?p="unique"',
        '/content/magic/mcguffin/test1.val.ts?p="unique"."name"',
        '/content/test2.val.ts?p="testKeyOf"',
      ].sort()
    );
    // date:
    expect(search(indices, "2021").sort()).toEqual(
      ['/content/test2.val.ts?p="testDate"'].sort()
    );
    expect(search(indices, "2021-01-01").sort()).toEqual(
      ['/content/test2.val.ts?p="testDate"'].sort()
    );
    expect(search(indices, "imageOfPerson.jpg").sort()).toEqual([
      '/content/test2.val.ts?p="testImage"',
    ]);

    // 0 results:
    expect(
      search(indices, "an hello world which we do not have").sort()
    ).toEqual([]);

    // source path lookups
    expect(search(indices, "testImage").sort()).toEqual([
      '/content/test2.val.ts?p="testImage"',
    ]);
    expect(
      search(
        indices,
        '/content/magic/mcguffin/test1.val.ts?p="unique"."name"'
      ).sort()
    ).toEqual(['/content/magic/mcguffin/test1.val.ts?p="unique"."name"']);
    expect(search(indices, "mcguffin").sort()).toEqual([
      "/content/magic/mcguffin/test1.val.ts",
      '/content/magic/mcguffin/test1.val.ts?p="unique"',
      '/content/magic/mcguffin/test1.val.ts?p="unique"."name"',
    ]);
    expect(
      search(indices, '/content/magic/mcguffin/test1.val.ts?p="unique"').sort()
    ).toEqual([
      '/content/magic/mcguffin/test1.val.ts?p="unique"',
      '/content/magic/mcguffin/test1.val.ts?p="unique"."name"',
    ]);
    // check that filter on source path works:
    expect(
      search(
        indices,
        '/content/magic/mcguffin/test1.val.ts?p="unique" Name of test'
      ).sort()
    ).toEqual(['/content/magic/mcguffin/test1.val.ts?p="unique"."name"']);
    expect(
      search(
        indices,
        '/content/test2.val.ts?p="testRichText" world within richtext'
      ).sort()
    ).toEqual(['/content/test2.val.ts?p="testRichText"'].sort());
  });
});

function createTestDate(data: ValModule<SelectorSource>[]) {
  const res: Record<
    ModuleFilePath,
    { source: Json; schema: SerializedSchema }
  > = {};
  for (const m of data) {
    res[Internal.getValPath(m) as unknown as ModuleFilePath] = {
      source: Internal.getSource(m),
      schema: Internal.getSchema(m)!["executeSerialize"](),
    };
  }
  return res;
}
