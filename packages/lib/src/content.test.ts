import { content } from "./content";
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
      ).val.get()
    ).toStrictEqual({
      foo: "bar",
    });
  });
});
