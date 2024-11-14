import { SourcePath } from "../val";
import { richtext } from "./richtext";

describe("RichTextSchema", () => {
  test("assert: should return success if src is richtext", () => {
    const schema = richtext();
    const src = [
      { tag: "p", children: ["Val is a CMS, which is useful because:"] },
      {
        tag: "ul",
        children: [
          {
            tag: "li",
            children: [
              {
                tag: "p",
                children: [
                  "It",
                  { tag: "span", styles: ["bold"], children: ["just"] },
                  " works",
                ],
              },
            ],
          },
        ],
      },
      {
        tag: "p",
        children: [
          "Visit ",
          { tag: "a", href: "https://val.build", children: ["Val"] },
          " for more information.",
        ],
      },
    ];
    expect(schema.assert("/richtext.val.ts" as SourcePath, src)).toEqual({
      success: true,
      data: src,
    });
  });

  test("assert: should return errors if src is invalid richtext", () => {
    const schema = richtext();
    const src = [
      { tag: "p", children: ["Val is a CMS, which is useful because:"] },
      {
        tag: 1, // <- error 1
      },
      {
        tag: "ul",
        children: [
          {
            tag: "li",
            children: [
              {
                tag: "p",
                children: [
                  "It",
                  42, // <- error
                  { tag: "span", styles: ["bold"], children: ["just"] },
                  " works",
                ],
              },
            ],
          },
        ],
      },
      {
        tag: "p",
        children: [
          "Visit ",
          { tag: "a", href: "https://val.build", children: ["Val"] },
          " for more information.",
        ],
      },
    ];
    const res = schema.assert("/richtext.val.ts" as SourcePath, src);
    expect(res.success).toEqual(false);
    if (!res.success) {
      expect(Object.keys(res.errors).sort()).toEqual(
        [
          `/richtext.val.ts?p=1`,
          `/richtext.val.ts?p=2."children".0."children".0."children".1`,
        ].sort(),
      );
      const errorAtPath =
        res.errors[
          `/richtext.val.ts?p=2."children".0."children".0."children".1` as SourcePath
        ];
      expect(errorAtPath).toBeDefined();
      expect(errorAtPath).toHaveLength(1);
    }
  });
});
