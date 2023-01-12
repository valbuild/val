import { array } from "./array";
import { string } from "./string";

describe("array schema", () => {
  test("array validation", () => {
    expect(
      array(
        string({
          maxLength: 11,
          minLength: 2,
        })
      ).validate(["Testing 1234", "Should pass", "1"])
    ).toHaveLength(2);
  });
});
