import { array } from "../schema/array";
import { object } from "../schema/object";
import { string } from "../schema/string";
import { i18n } from "../schema/i18n";
import { ModuleContent } from "../content";

test("selector", () => {
  const content = new ModuleContent(
    {
      foo: {
        bar: [
          {
            baz: {
              en_US: "foo",
            },
          },
          {
            baz: {
              en_US: "bar",
            },
          },
          {
            baz: {
              en_US: "baz",
            },
          },
        ],
      },
    },
    object({
      foo: object({
        bar: array(
          object({
            baz: i18n(string()),
          })
        ),
      }),
    })
  );

  const baz = content.select((root) => root.foo.bar[0].baz);
  expect(baz).toEqual("foo");
});
