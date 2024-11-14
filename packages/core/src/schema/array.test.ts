import { SourcePath } from "../val";
import { array } from "./array";
import { number } from "./number";

describe("ArraySchema", () => {
  test("assert: should return success if src is an array", () => {
    const schema = array(number());
    expect(schema.assert("path" as SourcePath, [])).toEqual({
      success: true,
      data: [],
    });
  });

  test("assert: should return error if src is string", () => {
    const schema = array(number());
    expect(schema.assert("path" as SourcePath, "").success).toEqual(false);
  });
});
