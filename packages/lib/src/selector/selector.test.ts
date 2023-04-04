import { array } from "../schema/array";
import { object } from "../schema/object";
import { string } from "../schema/string";
import { ModuleContent } from "../content";
import { parse } from "../expr";

test("selector", () => {
  const content = new ModuleContent(
    {
      foo: {
        bar: [
          {
            baz: "foo",
          },
          {
            baz: "bar",
          },
          {
            baz: "baz",
          },
        ],
      },
    },
    object({
      foo: object({
        bar: array(
          object({
            baz: string(),
          })
        ),
      }),
    })
  );
  // const a = content.schema.localDescriptor();

  const baz = content.select((root) => root.foo.bar[0].baz);
  expect(baz.evaluate([content.source])).toEqual("foo");

  expect(
    content
      .select((root) => root.foo.bar.filter((i) => i.baz.eq("foo")))
      .evaluate([content.source])
  ).toEqual([{ baz: "foo" }]);

  const exprString = baz.toString(["m"]);
  expect(exprString).toEqual(`m."foo"."bar".0."baz"`);
  const expr = parse<[typeof content.source]>({ m: 0 }, exprString);
  expect(expr).toEqual(baz);
  expect(expr.evaluate([content.source])).toEqual("foo");
});
