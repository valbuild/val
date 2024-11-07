import { SourcePath } from "../val";
import { image } from "./image";
import { file as sourceFile } from "../source/file";

describe("ImageSchema", () => {
  test("assert: should return success if src is a file", () => {
    const schema = image();
    const src = sourceFile("/public/val/features.png");
    expect(schema.assert("path" as SourcePath, src)).toEqual({
      success: true,
      data: src,
    });
  });

  test("assert: should return error if src is string", () => {
    const schema = image();
    const src = "test";
    expect(schema.assert("path" as SourcePath, src).success).toEqual(false);
  });
});
