import { content } from "./module";
import { i18n } from "./schema/i18n";
import { number } from "./schema/number";
import { object } from "./schema/object";
import { string } from "./schema/string";

describe("content function", () => {
  test("content initialization", () => {
    expect(
      content(
        "/id",
        object({
          foo: string(),
        }),
        {
          foo: "bar",
        }
      ).content.get()
    ).toStrictEqual({
      foo: "bar",
    });
  });

  test("i18n", () => {
    const mod = content("/id", object({ l: i18n(number()) }), {
      l: { en_US: 1 },
    });
    const asdf = mod.select((mod) => mod);
  });
});
