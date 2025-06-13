import { SourcePath } from "../val";
import { boolean } from "./boolean";

describe("BooleanSchema", () => {
  test("assert: should return success if src is a boolean", () => {
    const schema = boolean();
    expect(schema["executeAssert"]("path" as SourcePath, true)).toEqual({
      success: true,
      data: true,
    });
  });

  test("assert: should return error if src is string", () => {
    const schema = boolean();
    expect(schema["executeAssert"]("path" as SourcePath, "").success).toEqual(
      false,
    );
  });
});
