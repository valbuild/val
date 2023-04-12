import { array } from "./array";
import { Schema } from "./Schema";
import { string } from "./string";

describe("array schema", () => {
  test("array validation", () => {
    expect(
      Schema.validate(
        array(
          string({
            maxLength: 11,
            minLength: 2,
          })
        ),
        ["Testing 1234", "Should pass", "1"]
      )
    ).toHaveLength(2);
  });
});
