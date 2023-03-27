import { array } from "../schema/array";
import { object } from "../schema/object";
import { string } from "../schema/string";
import { i18n } from "../schema/i18n";
import { number } from "../schema/number";
import { ModuleContent } from "../content";

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

  const baz = content.select((root) => root.foo.bar[0].baz);
  expect(baz).toEqual("foo");

  expect(
    content.select((root) => {
      const bar = root.foo.bar;
      return bar.filter((i) => i.baz.eq("foo"));
    })
  ).toEqual([{ baz: "foo" }]);
});
