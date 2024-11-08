import { SourcePath } from "../val";
import { file } from "./file";
import { file as sourceFile } from "../source/file";

describe("FileSchema", () => {
  test("assert: should return success if src is a file", () => {
    const schema = file();
    const src = sourceFile("/public/val/features.pdf");
    const res = schema.assert("path" as SourcePath, src);
    expect(res).toEqual({
      success: true,
      data: src,
    });
  });
});