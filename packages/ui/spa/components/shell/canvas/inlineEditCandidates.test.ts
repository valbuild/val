import {
  Internal,
  ModuleFilePath,
  SelectorSource,
  SourcePath,
  ValModule,
  initVal,
} from "@valbuild/core";
import { inlineEditCandidates } from "./inlineEditCandidates";
import { inlineEditPatch } from "./useCanvasInlineEdit";

const { c, s } = initVal();
const page = c.define(
  "/app/page.val.ts",
  s.object({
    title: s.string(),
    lead: s.string().multiline(),
    slug: s.string().readonly(),
    subtitle: s.string().nullable(),
    year: s.number(),
    published: s.boolean(),
    body: s.richtext({ bold: true, h2: true }),
    legal: s.object({ notice: s.string() }).readonly(),
    sections: s.array(s.object({ heading: s.string() })),
  }),
  {
    title: "Our people",
    lead: "Forty of us,\nsince 2012.",
    slug: "our-people",
    subtitle: null,
    year: 2012,
    published: true,
    body: [
      { tag: "h2", children: ["Who we are"] },
      {
        tag: "p",
        children: [
          "We are ",
          { tag: "span", styles: ["bold"], children: ["forty"] },
          " people.",
        ],
      },
    ],
    legal: { notice: "All rights reserved" },
    sections: [{ heading: "Oslo" }, { heading: "Bergen" }],
  },
);

function candidates(paths: string[], module: ValModule<SelectorSource> = page) {
  const moduleFilePath = Internal.getValPath(
    module,
  ) as unknown as ModuleFilePath;
  return inlineEditCandidates(
    paths as SourcePath[],
    { [moduleFilePath]: Internal.getSource(module) },
    { [moduleFilePath]: Internal.getSchema(module)!["executeSerialize"]() },
  );
}

describe("what a pick offers the page for editing in place", () => {
  test("a string, with what it holds", () => {
    expect(candidates(['/app/page.val.ts?p="title"'])).toEqual([
      {
        path: '/app/page.val.ts?p="title"',
        kind: "string",
        value: "Our people",
      },
    ]);
  });

  test("a multiline string says so: its Enter is a new line", () => {
    expect(candidates(['/app/page.val.ts?p="lead"'])).toEqual([
      {
        path: '/app/page.val.ts?p="lead"',
        kind: "string",
        value: "Forty of us,\nsince 2012.",
        multiline: true,
      },
    ]);
  });

  test("a richtext, with its document", () => {
    expect(candidates(['/app/page.val.ts?p="body"'])).toEqual([
      {
        path: '/app/page.val.ts?p="body"',
        kind: "richtext",
        value: Internal.getSource(page).body,
      },
    ]);
  });

  test("a string inside a list, by its own path", () => {
    expect(
      candidates(['/app/page.val.ts?p="sections".1."heading"']),
    ).toMatchObject([{ kind: "string", value: "Bergen" }]);
  });

  test("of an element's several fields, the ones a caret means something in", () => {
    expect(
      candidates([
        '/app/page.val.ts?p="year"',
        '/app/page.val.ts?p="title"',
        '/app/page.val.ts?p="published"',
      ]).map((candidate) => candidate.path),
    ).toEqual(['/app/page.val.ts?p="title"']);
  });

  test("nothing that is read-only, or inside something that is", () => {
    expect(
      candidates([
        '/app/page.val.ts?p="slug"',
        '/app/page.val.ts?p="legal"."notice"',
      ]),
    ).toEqual([]);
  });

  test("nothing that holds no text yet, and nothing that is not there", () => {
    expect(
      candidates([
        '/app/page.val.ts?p="subtitle"',
        '/app/page.val.ts?p="gone"',
        '/app/other.val.ts?p="title"',
        "/app/page.val.ts",
      ]),
    ).toEqual([]);
  });

  test("nothing before the schemas are in", () => {
    expect(
      inlineEditCandidates(
        ['/app/page.val.ts?p="title"'] as SourcePath[],
        {},
        undefined,
      ),
    ).toEqual([]);
  });
});

describe("what an edit on the page writes", () => {
  const title = {
    path: '/app/page.val.ts?p="title"' as SourcePath,
    kind: "string" as const,
  };
  const body = {
    path: '/app/page.val.ts?p="body"' as SourcePath,
    kind: "richtext" as const,
  };

  test("a string field's own patch: the whole value, at the field's path", () => {
    expect(inlineEditPatch(title, "Our team")).toEqual([
      { op: "replace", path: ["title"], value: "Our team" },
    ]);
  });

  test("a richtext field's own patch: the whole document", () => {
    const document = [{ tag: "p", children: ["We are forty-two."] }];
    expect(inlineEditPatch(body, document)).toEqual([
      { op: "replace", path: ["body"], value: document },
    ]);
  });

  test("nothing, for a value that is not what the field holds", () => {
    expect(inlineEditPatch(title, [{ tag: "p", children: [] }])).toBeNull();
    expect(inlineEditPatch(body, "We are forty-two.")).toBeNull();
  });
});
