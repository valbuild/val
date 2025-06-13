import { initFile } from "../source/file";
import { SourcePath } from "../val";
import { file } from "./file";

const sourceFile = initFile();

describe("FileSchema", () => {
  test("assert: should return success if src is a file", () => {
    const schema = file();
    const src = sourceFile("/public/val/features.pdf");
    const res = schema["executeAssert"]("path" as SourcePath, src);
    expect(res).toEqual({
      success: true,
      data: src,
    });
  });
});
