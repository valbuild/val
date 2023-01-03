import { object } from "./object";
import { string } from "./string";

describe("object schema", () => {
  test("object validation", () => {
    expect(
      object({
        foo: string({
          maxLength: 2,
        }),
        bar: string({
          minLength: 2,
        }),
      }).validate({
        foo: "Testing 123",
        bar: "1",
      })
    ).toHaveLength(2);
  });
});
