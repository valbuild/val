import { SourcePath } from "../val";
import { array } from "./array";
import { number } from "./number";
import { object } from "./object";
import { string } from "./string";

describe("ArraySchema", () => {
  test("assert: should return success if src is an array", () => {
    const schema = array(number());
    expect(schema["executeAssert"]("path" as SourcePath, [])).toEqual({
      success: true,
      data: [],
    });
  });

  test("assert: should return error if src is string", () => {
    const schema = array(number());
    expect(schema["executeAssert"]("path" as SourcePath, "").success).toEqual(
      false,
    );
  });
  test("preview: preview is kept when chaining after preview", () => {
    const base = array(object({ name: string() })).preview(({ val }) => ({
      title: val.name,
    }));
    const src = [{ name: "Ada" }];
    const expected = {
      "/test.val.ts": {
        status: "success",
        data: {
          parent: "array",
          // `[index, value]`, matching the record shape: a windowed preview (see
          // PreviewScope) carries only the rows that were asked for, so the
          // index travels with the item rather than being its position.
          items: [[0, { title: "Ada", subtitle: undefined, image: undefined }]],
        },
      },
    };
    for (const schema of [
      base,
      base.nullable(),
      base.readonly(),
      base.hidden(),
      base.describe("Some description"),
      base.validate(() => false),
    ]) {
      expect(
        schema["executePreview"]("/test.val.ts" as SourcePath, src),
      ).toEqual(expected);
    }
  });

  test("preview: does not mutate the schema it was called on", () => {
    const base = array(object({ name: string() }));
    base.preview(({ val }) => ({ title: val.name }));
    expect(
      base["executePreview"]("/test.val.ts" as SourcePath, [{ name: "Ada" }]),
    ).toEqual({});
  });
});
