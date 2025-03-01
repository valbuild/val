import { deepEqual } from "../patch";
import { AllRichTextOptions, RichTextSource } from "../source/richtext";
import { SourcePath } from "../val";
import { richtext } from "./richtext";
import { ValidationErrors } from "./validation/ValidationError";

describe("RichTextSchema", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const testValidateInput: RichTextSource<AllRichTextOptions> = [
    { tag: "h1", children: ["What is Val?"] },
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

  test("validate: basic green test", () => {
    const schema = richtext({
      style: {
        bold: true,
      },
      block: {
        h1: true,
        ul: true,
      },
      inline: {
        a: true,
      },
    });
    expectedErrorAtPaths(
      schema.validate(
        "/richtext.val.ts" as SourcePath,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        testValidateInput as any,
      ),
      [],
    );
  });

  test("validate: basic red test", () => {
    const schema = richtext();
    expectedErrorAtPaths(
      schema.validate(
        "/richtext.val.ts" as SourcePath,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        testValidateInput as any,
      ),
      [
        "/richtext.val.ts?p=0",
        "/richtext.val.ts?p=2",
        '/richtext.val.ts?p=2."children".0',
        '/richtext.val.ts?p=2."children".0."children".0."children".0."styles".0',
        '/richtext.val.ts?p=3."children".0',
      ],
    );
  });

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

function expectedErrorAtPaths(errors: ValidationErrors, paths: string[]) {
  if (paths.length === 0) {
    expect(errors).toEqual(false);
    return;
  }
  const allPaths = Object.keys(errors).sort();
  if (!deepEqual(allPaths, paths)) {
    console.error("Found errors", errors);
  }
  expect(allPaths).toEqual(paths.sort());
}
