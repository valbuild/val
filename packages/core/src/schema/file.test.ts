import { SourcePath } from "../val";
import { file } from "./file";

describe("FileSchema", () => {
  test("assert: should return success if src is a file", () => {
    const schema = file();
    const src = { path: "/public/val/features.pdf" };
    const res = schema["executeAssert"]("path" as SourcePath, src);
    expect(res).toEqual({
      success: true,
      data: src,
    });
  });

  test("assert: should return error if src has no path", () => {
    const schema = file();
    expect(
      schema["executeAssert"]("path" as SourcePath, { mimeType: "text/plain" })
        .success,
    ).toEqual(false);
  });
});
