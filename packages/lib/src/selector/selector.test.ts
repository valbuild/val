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

test("numbers", () => {
  const content = new ModuleContent(
    [
      {
        name: "foo",
        value: 2,
      },
      {
        name: "bar",
        value: 1,
      },
      {
        name: "baz",
        value: 0,
      },
    ],
    array(
      object({
        name: string(),
        value: number(),
      })
    )
  );

  const baz = content.select((content) =>
    content.sort((a, b) => a.value.sub(b.value))
  );
  expect(baz).toEqual([
    {
      name: "baz",
      value: 0,
    },
    {
      name: "bar",
      value: 1,
    },
    {
      name: "foo",
      value: 2,
    },
  ]);
});
