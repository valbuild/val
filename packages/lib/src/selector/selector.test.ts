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
            en_US: {
              baz: "foo",
            },
          },
          {
            en_US: {
              baz: "bar",
            },
          },
          {
            en_US: {
              baz: "baz",
            },
          },
        ],
      },
    },
    object({
      foo: object({
        bar: array(
          i18n(
            object({
              baz: string(),
            })
          )
        ),
      }),
    })
  );

  const baz = content.select((root) => root.foo.bar[0].baz);
  expect(baz).toEqual("foo");
});
