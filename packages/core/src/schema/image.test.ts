import { initFile } from "../source/file";
import { SourcePath } from "../val";
import { image } from "./image";

const sourceFile = initFile();
describe("ImageSchema", () => {
  test("assert: should return success if src is a file", () => {
    const schema = image();
    const src = sourceFile("/public/val/features.png");
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
});
