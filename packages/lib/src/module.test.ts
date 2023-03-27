import { content } from "./module";
import { object } from "./schema/object";
import { string } from "./schema/string";

describe("content function", () => {
  test("content initialization", () => {
    expect(
      content(
        "/id",
        object({
          foo: string(),
          bar: string().optional(),
        }),
        {
          foo: "bar",
          bar: null,
        }
      ).content.get()
    ).toStrictEqual({
      foo: "bar",
      bar: null,
    });
  });
});
