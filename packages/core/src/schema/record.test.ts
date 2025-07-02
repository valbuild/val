/* eslint-disable @typescript-eslint/no-explicit-any */
import { SourcePath } from "../val";
import { number } from "./number";
import { object } from "./object";
import { record } from "./record";
import { string } from "./string";

describe("RecordSchema", () => {
  test("assert: basic record", () => {
    const schema = record(number().nullable());
    expect(schema["executeAssert"]("foo" as SourcePath, { bar: 1 })).toEqual({
      success: true,
      data: { bar: 1 },
    });
  });

  test("record: nested renders", () => {
    const schema = record(
      object({
        title: string(),
        bar: record(
          object({
            baz: string().nullable(),
          }),
        ).render({
          layout: "list",
          select: ({ val }) => {
            return {
              title: val.baz || "No baz",
            };
          },
        }),
      }).nullable(),
    ).render({
      layout: "list",
      select: ({ val }) => {
        return {
          title: val?.title || "No item",
        };
      },
    });
    const src = {
      "upper-key": {
        title: "test",
        bar: {
          test1: {
            baz: "baz",
          },
        },
      },
      "nullable-key": null,
    };
    const res = schema["executeRender"]("/test.val.ts" as SourcePath, src);
    expect(res).toStrictEqual({
      '/test.val.ts?p="upper-key"."bar"': {
        status: "success",
        data: {
          layout: "list",
          parent: "record",
          items: [
            ["test1", { title: "baz", subtitle: undefined, image: undefined }],
          ],
        },
      },
      "/test.val.ts": {
        status: "success",
        data: {
          layout: "list",
          parent: "record",
          items: [
            [
              "upper-key",
              { title: "test", subtitle: undefined, image: undefined },
            ],
            [
              "nullable-key",
              { title: "No item", subtitle: undefined, image: undefined },
            ],
          ],
        },
      },
    });
  });
});
