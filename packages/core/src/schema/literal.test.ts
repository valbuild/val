import { SourcePath } from "../val";
import { literal } from "./literal";

describe("LiteralSchema", () => {
  test("assert: should return success if src is a literal", () => {
    const schema = literal("val");
    const src = "val";
    expect(schema["executeAssert"]("path" as SourcePath, src)).toEqual({
      success: true,
      data: src,
    });
  });
});
