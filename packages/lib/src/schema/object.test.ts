import { object } from "./object";
import { Schema } from "./Schema";
import { string } from "./string";

describe("object schema", () => {
  test("object validation", () => {
    expect(
      Schema.validate(
        object({
          foo: string({
            maxLength: 2,
          }),
          bar: string({
            minLength: 2,
          }),
        }),
        {
          foo: "Testing 123",
          bar: "1",
        }
      )
    ).toHaveLength(2);
  });
});
