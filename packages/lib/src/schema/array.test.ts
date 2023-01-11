import { array } from "./array";
import { string } from "./string";

describe("array schema", () => {
  test("array validation", () => {
    expect(
      array(
        string({
          maxLength: 3,
          minLength: 2,
        })
      ).validate(["Testing 123", "1"])
    ).toHaveLength(2);
  });
});
