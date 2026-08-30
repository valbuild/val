import { SourcePath } from "../val";
import { ImageSource } from "../source/media";
import { image, ImageOptions, ImageSchema } from "./image";

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

describe("ImageSchema encode option", () => {
  /** `executeSerialize` answers with the whole union, so narrow before reading. */
  const optionsOf = (schema: ImageSchema<ImageSource>): ImageOptions => {
    const serialized = schema["executeSerialize"]();
    if (serialized.type !== "image") {
      throw new Error(`Expected an image schema, got '${serialized.type}'`);
    }
    return serialized.options ?? {};
  };

  test("serialize: carries what the schema asked for", () => {
    expect(
      optionsOf(image({ encode: { type: "webp", quality: 0.5 } })),
    ).toEqual({ encode: { type: "webp", quality: 0.5 } });
  });

  test("serialize: carries an explicit opt-out", () => {
    expect(optionsOf(image({ encode: false }))).toEqual({ encode: false });
  });

  /**
   * Off is the default, so a schema that says nothing must serialize nothing:
   * a `false` invented here would be indistinguishable from an author's.
   */
  test("serialize: says nothing when the schema said nothing", () => {
    expect(optionsOf(image())).toEqual({});
    expect(optionsOf(image({ directory: "/public/val" }))).toEqual({
      directory: "/public/val",
    });
  });
});
