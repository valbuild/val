import { SourcePath } from "../val";
import { image } from "./image";

describe("ImageSchema", () => {
  test("assert: should return success if src is an image", () => {
    const schema = image();
    const src = { path: "/public/val/features.png" };
    expect(schema["executeAssert"]("path" as SourcePath, src)).toEqual({
      success: true,
      data: src,
    });
  });

  test("assert: should return error if src is string", () => {
    const schema = image();
    const src = "test";
    expect(schema["executeAssert"]("path" as SourcePath, src).success).toEqual(
      false,
    );
  });

  test("assert: should return error if src has no path", () => {
    const schema = image();
    expect(
      schema["executeAssert"]("path" as SourcePath, { width: 8, height: 8 })
        .success,
    ).toEqual(false);
  });
});
