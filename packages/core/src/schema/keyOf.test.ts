import { define } from "../module";
import { SourcePath } from "../val";
import { keyOf } from "./keyOf";
import { object } from "./object";
import { record } from "./record";
import { string } from "./string";

describe("KeyOfSchema", () => {
  test("assert: should return success if src is a keyOf value", () => {
    const schema = keyOf(
      define("/path2", record(object({ key: string() })), {
        one: { key: "test" },
      })
    );
    const src = "one";
    const res = schema.assert("path" as SourcePath, src);
    expect(res).toEqual({
      success: true,
      data: src,
    });
  });
});
