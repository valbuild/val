import { array } from "./schema/array";
import { object } from "./schema/object";
import { string } from "./schema/string";
import { ModuleContent } from "./content";
import { parse } from "./expr";

describe("select", () => {
  const source = {
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
  } as const;
  const content = new ModuleContent(
    source,
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

  test("basic nested property", () => {
    const expr = content.select((root) => root.foo.bar[0].baz);
    expect(expr).toEqual(
      parse<readonly [typeof content.source]>({ "": 0 }, `."foo"."bar".0."baz"`)
    );
    expect(expr.evaluate([content.localize("en_US")])).toEqual(
      source.foo.bar[0].baz
    );
  });

  test("array with filter", () => {
    const expr = content.select((root) =>
      root.foo.bar.filter((i) => i.baz.eq("foo"))
    );
    expect(expr).toEqual(
      parse<readonly [typeof content.source]>(
        { "": 0 },
        `."foo"."bar".filter((v) => v."baz".eq("foo"))`
      )
    );
    expect(expr.evaluate([content.localize("en_US")])).toEqual(
      source.foo.bar.filter((i) => i.baz === "foo")
    );
  });
});
