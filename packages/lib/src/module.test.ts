import { content } from "./module";
import { object } from "./schema/object";
import { string } from "./schema/string";

describe("content function", () => {
  test("content initialization", () => {
    expect(
      content("/id", () =>
        object({
          foo: string(),
        }).fixed({
          foo: "bar",
        })
      ).content.get()
    ).toStrictEqual({
      foo: "bar",
    });
  });
});
