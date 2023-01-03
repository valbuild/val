import { string } from "./string";

describe("string schema", () => {
  test("string validation", () => {
    expect(
      string({
        maxLength: 2,
      }).validate("Testing 123")
    ).toHaveLength(1);
  });
});
