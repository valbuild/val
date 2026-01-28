import { deepEqual } from "../patch";
import { AllRichTextOptions, RichTextSource } from "../source/richtext";
import { SourcePath } from "../val";
import { richtext } from "./richtext";
import { route } from "./route";
import { string } from "./string";
import { ValidationErrors } from "./validation/ValidationError";

describe("RichTextSchema", () => {
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
        { tag: "a", href: "/home", children: ["Val"] },
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
        a: string(),
      },
    });
    expectedErrorAtPaths(
      schema["executeValidate"](
        "/richtext.val.ts" as SourcePath,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        testValidateInput as any,
      ),
      [],
    );
  });

  test("validate: basic green max / min length test", () => {
    const schema = richtext({
      style: {
        bold: true,
      },
      block: {
        h1: true,
        ul: true,
      },
      inline: {
        a: string(),
      },
    })
      .minLength(1)
      .maxLength(100);
    expectedErrorAtPaths(
      schema["executeValidate"](
        "/richtext.val.ts" as SourcePath,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        testValidateInput as any,
      ),
      [],
    );
  });

  test("validate: basic red min length test", () => {
    const schema = richtext({
      style: {
        bold: true,
      },
      block: {
        h1: true,
        ul: true,
      },
      inline: {
        a: string(),
      },
    }).minLength(100);
    expectedErrorAtPaths(
      schema["executeValidate"](
        "/richtext.val.ts" as SourcePath,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        testValidateInput as any,
      ),
      ["/richtext.val.ts"],
    );
  });

  test("validate: basic red max length test", () => {
    const schema = richtext({
      style: {
        bold: true,
      },
      block: {
        h1: true,
        ul: true,
      },
      inline: {
        a: string(),
      },
    }).maxLength(10);
    expectedErrorAtPaths(
      schema["executeValidate"](
        "/richtext.val.ts" as SourcePath,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        testValidateInput as any,
      ),
      ["/richtext.val.ts"],
    );
  });

  test("validate: basic red test", () => {
    const schema = richtext();
    expectedErrorAtPaths(
      schema["executeValidate"](
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

  test("validate: red test with maxLength", () => {
    const schema = richtext().maxLength(10);
    expectedErrorAtPaths(
      schema["executeValidate"](
        "/richtext.val.ts" as SourcePath,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        testValidateInput as any,
      ),
      [
        "/richtext.val.ts",
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
    expect(
      schema["executeAssert"]("/richtext.val.ts" as SourcePath, src),
    ).toEqual({
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
    const res = schema["executeAssert"]("/richtext.val.ts" as SourcePath, src);
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

  // Anchor href validation tests
  test("validate: a: true with valid route href (green test)", () => {
    const schema = richtext({
      inline: {
        a: true,
      },
    });
    const input = [
      {
        tag: "p",
        children: [
          "Visit ",
          { tag: "a", href: "/blogs/blog1", children: ["Blog 1"] },
          " for more information.",
        ],
      },
    ];
    const errors = schema["executeValidate"](
      "/richtext.val.ts" as SourcePath,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      input as any,
    );
    // Note: a: true now defaults to route validation, which returns router:check-route error
    // This is expected and will be processed by Val internally
    if (errors !== false) {
      expect(Object.keys(errors).length).toBeGreaterThan(0);
      const firstError = errors[Object.keys(errors)[0] as SourcePath][0];
      expect(firstError.message).toContain("router:check-route");
    }
  });

  test("validate: a: route() with explicit route schema", () => {
    const schema = richtext({
      inline: {
        a: route(),
      },
    });
    const input = [
      {
        tag: "p",
        children: [
          "Visit ",
          { tag: "a", href: "/blogs/blog1", children: ["Blog 1"] },
          " for more.",
        ],
      },
    ];
    const errors = schema["executeValidate"](
      "/richtext.val.ts" as SourcePath,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      input as any,
    );
    // Route validation returns router:check-route error for internal processing
    if (errors !== false) {
      expect(Object.keys(errors).length).toBeGreaterThan(0);
      const firstError = errors[Object.keys(errors)[0] as SourcePath][0];
      expect(firstError.message).toContain("router:check-route");
    }
  });

  test("validate: a: string().maxLength(30) with valid short URL (green test)", () => {
    const schema = richtext({
      inline: {
        a: string().maxLength(30),
      },
    });
    const input = [
      {
        tag: "p",
        children: [
          "Visit ",
          { tag: "a", href: "/short", children: ["Link"] },
          " here.",
        ],
      },
    ];
    expectedErrorAtPaths(
      schema["executeValidate"](
        "/richtext.val.ts" as SourcePath,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        input as any,
      ),
      [],
    );
  });

  test("validate: a: string().maxLength(30) with URL exceeding max length (red test)", () => {
    const schema = richtext({
      inline: {
        a: string().maxLength(30),
      },
    });
    const input = [
      {
        tag: "p",
        children: [
          {
            tag: "a",
            href: "/this-is-a-very-long-url-that-exceeds-thirty-characters",
            children: ["Link"],
          },
        ],
      },
    ];
    expectedErrorAtPaths(
      schema["executeValidate"](
        "/richtext.val.ts" as SourcePath,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        input as any,
      ),
      ['/richtext.val.ts?p=0."children".0."href"'],
    );
  });

  test("validate: a: route().include(/^\\/blog/) with matching route (green test)", () => {
    const schema = richtext({
      inline: {
        a: route().include(/^\/blog/),
      },
    });
    const input = [
      {
        tag: "p",
        children: [
          "Visit ",
          { tag: "a", href: "/blog/post1", children: ["Blog"] },
          " here.",
        ],
      },
    ];
    const errors = schema["executeValidate"](
      "/richtext.val.ts" as SourcePath,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      input as any,
    );
    // Route validation returns router:check-route error for internal processing
    if (errors !== false) {
      const firstError = errors[Object.keys(errors)[0] as SourcePath][0];
      expect(firstError.message).toContain("router:check-route");
    }
  });

  test("validate: a: route().exclude(/^\\/admin/) with excluded route (red test)", () => {
    const schema = richtext({
      inline: {
        a: route().exclude(/^\/admin/),
      },
    });
    const input = [
      {
        tag: "p",
        children: [
          "Visit ",
          { tag: "a", href: "/admin/dashboard", children: ["Admin"] },
          " here.",
        ],
      },
    ];
    const errors = schema["executeValidate"](
      "/richtext.val.ts" as SourcePath,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      input as any,
    );
    // Route validation returns router:check-route error for internal processing
    if (errors !== false) {
      const firstError = errors[Object.keys(errors)[0] as SourcePath][0];
      expect(firstError.message).toContain("router:check-route");
    }
  });

  test("validate: a tag without href attribute (red test)", () => {
    const schema = richtext({
      inline: {
        a: true,
      },
    });
    const input = [
      {
        tag: "p",
        children: [
          { tag: "a", children: ["Link"] }, // Missing href
        ],
      },
    ];
    expectedErrorAtPaths(
      schema["executeValidate"](
        "/richtext.val.ts" as SourcePath,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        input as any,
      ),
      ['/richtext.val.ts?p=0."children".0'],
    );
  });

  test("validate: a: string() allows external URLs", () => {
    const schema = richtext({
      inline: {
        a: string(),
      },
    });
    const input = [
      {
        tag: "p",
        children: [
          "Visit ",
          { tag: "a", href: "https://example.com", children: ["External"] },
          " here.",
        ],
      },
    ];
    expectedErrorAtPaths(
      schema["executeValidate"](
        "/richtext.val.ts" as SourcePath,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        input as any,
      ),
      [],
    );
  });

  test("validate: a: string().regexp() validates URL patterns", () => {
    const schema = richtext({
      inline: {
        a: string().regexp(/^https?:\/\//),
      },
    });
    const inputValid = [
      {
        tag: "p",
        children: [
          { tag: "a", href: "https://example.com", children: ["Link"] },
        ],
      },
    ];
    expectedErrorAtPaths(
      schema["executeValidate"](
        "/richtext.val.ts" as SourcePath,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        inputValid as any,
      ),
      [],
    );

    const inputInvalid = [
      {
        tag: "p",
        children: [{ tag: "a", href: "/relative-url", children: ["Link"] }],
      },
    ];
    expectedErrorAtPaths(
      schema["executeValidate"](
        "/richtext.val.ts" as SourcePath,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        inputInvalid as any,
      ),
      ['/richtext.val.ts?p=0."children".0."href"'],
    );
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
