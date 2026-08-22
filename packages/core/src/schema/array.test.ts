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
  test("render: list render is kept when chaining after render", () => {
    const base = array(object({ name: string() })).render({
      as: "list",
      select: ({ val }) => ({ title: val.name }),
    });
    const src = [{ name: "Ada" }];
    const expected = {
      "/test.val.ts": {
        status: "success",
        data: {
          layout: "list",
          parent: "array",
          items: [{ title: "Ada", subtitle: undefined, image: undefined }],
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
        schema["executeRender"]("/test.val.ts" as SourcePath, src),
      ).toEqual(expected);
    }
  });

  test("render: does not mutate the schema it was called on", () => {
    const base = array(object({ name: string() }));
    base.render({
      as: "list",
      select: ({ val }) => ({ title: val.name }),
    });
    expect(
      base["executeRender"]("/test.val.ts" as SourcePath, [{ name: "Ada" }]),
    ).toEqual({});
  });
});
