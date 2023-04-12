import { Schema } from "./Schema";
import { string } from "./string";

describe("string schema", () => {
  test("string validation", () => {
    expect(
      Schema.validate(
        string({
          maxLength: 2,
        }),
        "Testing 123"
      )
    ).toHaveLength(1);
  });
});
