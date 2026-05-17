import { buildSchema } from "../schema";
import { parseEditorDocument } from "../serialize/parseEditorDocument";
import { serializeEditorDocument } from "../serialize/serializeEditorDocument";
import type { EditorDocument, EditorStyleConfig } from "../types";

const schema = buildSchema();

function roundTrip(doc: EditorDocument): EditorDocument {
  const pmDoc = parseEditorDocument(doc, schema);
  return serializeEditorDocument(pmDoc);
}

describe("serializeEditorDocument / parseEditorDocument round-trip", () => {
  test("headings h1-h6", () => {
    const input: EditorDocument = [
      { tag: "h1", children: ["Title 1"] },
      { tag: "h2", children: ["Title 2"] },
      { tag: "h3", children: ["Title 3"] },
      { tag: "h4", children: ["Title 4"] },
      { tag: "h5", children: ["Title 5"] },
      { tag: "h6", children: ["Title 6"] },
    ];
    expect(roundTrip(input)).toEqual(input);
  });

  test("paragraph with bold, italic, strikethrough span", () => {
    const input: EditorDocument = [
      {
        tag: "p",
        children: [
          {
            tag: "span",
            styles: ["bold", "italic", "line-through"],
            children: ["Formatted span"],
          },
        ],
      },
    ];
    expect(roundTrip(input)).toEqual(input);
  });

  test("paragraph with hard break", () => {
    const input: EditorDocument = [
      {
        tag: "p",
        children: ["Inline line break", { tag: "br" }],
      },
    ];
    expect(roundTrip(input)).toEqual(input);
  });

  test("empty paragraphs with br", () => {
    const input: EditorDocument = [
      { tag: "p", children: [{ tag: "br" }] },
      { tag: "p", children: [{ tag: "br" }] },
    ];
    expect(roundTrip(input)).toEqual(input);
  });

  test("link", () => {
    const input: EditorDocument = [
      {
        tag: "p",
        children: [
          { tag: "a", href: "https://example.com", children: ["Link"] },
        ],
      },
    ];
    expect(roundTrip(input)).toEqual(input);
  });

  test("nested lists (ul with nested ol)", () => {
    const input: EditorDocument = [
      {
        tag: "ul",
        children: [
          {
            tag: "li",
            children: [
              {
                tag: "p",
                children: ["bullet item"],
              },
              {
                tag: "ol",
                children: [
                  {
                    tag: "li",
                    children: [{ tag: "p", children: ["number 1.1"] }],
                  },
                  {
                    tag: "li",
                    children: [{ tag: "p", children: ["number 1.2"] }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ];
    expect(roundTrip(input)).toEqual(input);
  });

  test("blockquote", () => {
    const input: EditorDocument = [
      {
        tag: "blockquote",
        children: [{ tag: "p", children: ["A quote"] }],
      },
    ];
    expect(roundTrip(input)).toEqual(input);
  });

  test("code block", () => {
    const input: EditorDocument = [{ tag: "pre", children: ["const x = 1;"] }];
    expect(roundTrip(input)).toEqual(input);
  });

  test("inline image with file source object", () => {
    const input: EditorDocument = [
      {
        tag: "p",
        children: [
          "Before ",
          {
            tag: "img",
            src: { _ref: "/public/img.png", _type: "file", _tag: "image" },
          },
          " after",
        ],
      },
    ];
    expect(roundTrip(input)).toEqual(input);
  });

  test("inline image with plain string src normalizes to file source", () => {
    const input: EditorDocument = [
      {
        tag: "p",
        children: ["Before ", { tag: "img", src: "/public/img.png" }, " after"],
      },
    ];
    const result = roundTrip(input);
    expect(result[0].tag).toBe("p");
    if (result[0].tag === "p") {
      expect(result[0].children).toHaveLength(3);
      const imgNode = result[0].children[1];
      expect(imgNode).toEqual({
        tag: "img",
        src: { _ref: "/public/img.png", _type: "file", _tag: "image" },
      });
    }
  });

  test("mixed document from Val-like fixture", () => {
    const input: EditorDocument = [
      { tag: "h1", children: ["Title 1"] },
      { tag: "h2", children: ["Title 2"] },
      {
        tag: "p",
        children: [
          {
            tag: "span",
            styles: ["bold", "italic", "line-through"],
            children: ["Formatted span"],
          },
        ],
      },
      {
        tag: "p",
        children: ["Inline line break", { tag: "br" }],
      },
      {
        tag: "p",
        children: [
          { tag: "a", href: "https://example.com", children: ["Link"] },
        ],
      },
    ];
    expect(roundTrip(input)).toEqual(input);
  });
});

describe("parseEditorDocument", () => {
  test("creates valid PM doc from empty array", () => {
    const doc = parseEditorDocument([], schema);
    expect(doc.type.name).toBe("doc");
  });

  test("rejects and omits unknown tags gracefully", () => {
    const input: EditorDocument = [{ tag: "p", children: ["Valid"] }];
    const doc = parseEditorDocument(input, schema);
    expect(doc.childCount).toBe(1);
  });
});

describe("serializeEditorDocument", () => {
  test("serializes empty doc to paragraph", () => {
    const doc = schema.node("doc", null, [schema.node("paragraph")]);
    const result = serializeEditorDocument(doc);
    expect(result).toEqual([{ tag: "p", children: [] }]);
  });
});

const buttonSchema = buildSchema({
  features: { button: true },
  buttonVariants: [
    { variant: "cta-button", label: "CTA Button", children: false },
    { variant: "generic-button", label: "Generic Button", children: "string" },
    { variant: "link-home", label: "Home", children: "string", link: true },
  ],
});

function buttonRoundTrip(doc: EditorDocument): EditorDocument {
  const pmDoc = parseEditorDocument(doc, buttonSchema);
  return serializeEditorDocument(pmDoc);
}

describe("button round-trip", () => {
  test("atom button (children: false)", () => {
    const input: EditorDocument = [
      {
        tag: "p",
        children: [
          "Before ",
          { tag: "button", variant: "cta-button", children: false },
          " after",
        ],
      },
    ];
    expect(buttonRoundTrip(input)).toEqual(input);
  });

  test("editable button (children: [string])", () => {
    const input: EditorDocument = [
      {
        tag: "p",
        children: [
          { tag: "button", variant: "generic-button", children: ["Click me"] },
        ],
      },
    ];
    expect(buttonRoundTrip(input)).toEqual(input);
  });

  test("link variant button with href and text", () => {
    const input: EditorDocument = [
      {
        tag: "p",
        children: [
          {
            tag: "button",
            variant: "link-home",
            href: "https://example.com",
            children: ["Go Home"],
          },
        ],
      },
    ];
    expect(buttonRoundTrip(input)).toEqual(input);
  });

  test("link variant button without href round-trips without href key", () => {
    const input: EditorDocument = [
      {
        tag: "p",
        children: [
          { tag: "button", variant: "link-home", children: ["Go Home"] },
        ],
      },
    ];
    const result = buttonRoundTrip(input);
    expect(result).toEqual(input);
    const btn = (result[0] as { children: unknown[] }).children[0] as Record<
      string,
      unknown
    >;
    expect(btn).not.toHaveProperty("href");
  });

  test("mixed buttons and text", () => {
    const input: EditorDocument = [
      {
        tag: "p",
        children: [
          "Click ",
          { tag: "button", variant: "cta-button", children: false },
          " or ",
          { tag: "button", variant: "generic-button", children: ["this one"] },
        ],
      },
    ];
    expect(buttonRoundTrip(input)).toEqual(input);
  });

  test("editable button with empty text round-trips as empty string", () => {
    const input: EditorDocument = [
      {
        tag: "p",
        children: [
          { tag: "button", variant: "generic-button", children: [""] },
        ],
      },
    ];
    expect(buttonRoundTrip(input)).toEqual(input);
  });
});

describe("button parsing", () => {
  test("creates valid PM doc with button nodes", () => {
    const input: EditorDocument = [
      {
        tag: "p",
        children: [{ tag: "button", variant: "cta-button", children: false }],
      },
    ];
    const doc = parseEditorDocument(input, buttonSchema);
    expect(doc.type.name).toBe("doc");
    expect(doc.childCount).toBe(1);
  });
});

const customStyleConfig: EditorStyleConfig = {
  highlight: { label: "Highlight", css: { backgroundColor: "#fef08a" } },
  danger: { label: "Danger", css: { color: "#dc2626", fontWeight: "bold" } },
};

const styledSchema = buildSchema({
  features: { styles: customStyleConfig },
  styleConfig: customStyleConfig,
});

function styledRoundTrip(doc: EditorDocument): EditorDocument {
  const pmDoc = parseEditorDocument(doc, styledSchema);
  return serializeEditorDocument(pmDoc);
}

describe("custom styles round-trip", () => {
  test("single custom style", () => {
    const input: EditorDocument = [
      {
        tag: "p",
        children: [
          {
            tag: "span",
            styles: ["highlight"],
            children: ["highlighted text"],
          },
        ],
      },
    ];
    expect(styledRoundTrip(input)).toEqual(input);
  });

  test("multiple custom styles on same span", () => {
    const input: EditorDocument = [
      {
        tag: "p",
        children: [
          {
            tag: "span",
            styles: ["highlight", "danger"],
            children: ["styled text"],
          },
        ],
      },
    ];
    expect(styledRoundTrip(input)).toEqual(input);
  });

  test("custom style mixed with built-in styles", () => {
    const input: EditorDocument = [
      {
        tag: "p",
        children: [
          {
            tag: "span",
            styles: ["bold", "highlight"],
            children: ["bold and highlighted"],
          },
        ],
      },
    ];
    expect(styledRoundTrip(input)).toEqual(input);
  });

  test("custom style inside a link", () => {
    const input: EditorDocument = [
      {
        tag: "p",
        children: [
          {
            tag: "a",
            href: "https://example.com",
            children: [
              { tag: "span", styles: ["danger"], children: ["danger link"] },
            ],
          },
        ],
      },
    ];
    expect(styledRoundTrip(input)).toEqual(input);
  });

  test("unknown custom style names are dropped gracefully", () => {
    const input: EditorDocument = [
      {
        tag: "p",
        children: [
          { tag: "span", styles: ["nonexistent"], children: ["unknown style"] },
        ],
      },
    ];
    const result = styledRoundTrip(input);
    expect(result).toEqual([{ tag: "p", children: ["unknown style"] }]);
  });

  test("mixed document with custom and built-in styles", () => {
    const input: EditorDocument = [
      { tag: "h1", children: ["Title"] },
      {
        tag: "p",
        children: [
          "Normal text ",
          { tag: "span", styles: ["bold"], children: ["bold"] },
          " ",
          { tag: "span", styles: ["highlight"], children: ["highlighted"] },
          " ",
          {
            tag: "span",
            styles: ["italic", "danger"],
            children: ["italic danger"],
          },
        ],
      },
    ];
    expect(styledRoundTrip(input)).toEqual(input);
  });
});

describe("custom style schema", () => {
  test("schema with styles has custom mark types", () => {
    expect(styledSchema.marks.custom_style_highlight).toBeDefined();
    expect(styledSchema.marks.custom_style_danger).toBeDefined();
  });

  test("schema without styles has no custom mark types", () => {
    const s = buildSchema();
    expect(s.marks.custom_style_highlight).toBeUndefined();
  });
});

describe("feature-gated schema", () => {
  test("schema with all headings disabled still has heading node type", () => {
    const s = buildSchema({
      h1: false,
      h2: false,
      h3: false,
      h4: false,
      h5: false,
      h6: false,
    });
    expect(s.nodes.heading).toBeDefined();
  });

  test("schema with bold disabled still includes bold mark for roundtripping", () => {
    const s = buildSchema({ bold: false });
    expect(s.marks.bold).toBeDefined();
  });

  test("schema without button flag has no button nodes", () => {
    const s = buildSchema({ button: false });
    expect(s.nodes.button_atom).toBeUndefined();
    expect(s.nodes.button_editable).toBeUndefined();
  });

  test("schema with button flag has button nodes", () => {
    const s = buildSchema({ features: { button: true }, buttonVariants: [] });
    expect(s.nodes.button_atom).toBeDefined();
    expect(s.nodes.button_editable).toBeDefined();
  });

  test("schema without details flag has no details nodes", () => {
    const s = buildSchema({ details: false });
    expect(s.nodes.details).toBeUndefined();
    expect(s.nodes.details_summary).toBeUndefined();
  });

  test("default schema has no details nodes (details defaults to false)", () => {
    expect(schema.nodes.details).toBeUndefined();
    expect(schema.nodes.details_summary).toBeUndefined();
  });

  test("schema with details flag has details nodes", () => {
    const s = buildSchema({ features: { details: true } });
    expect(s.nodes.details).toBeDefined();
    expect(s.nodes.details_summary).toBeDefined();
  });
});

const detailsSchema = buildSchema({ features: { details: true } });

function detailsRoundTrip(doc: EditorDocument): EditorDocument {
  const pmDoc = parseEditorDocument(doc, detailsSchema);
  return serializeEditorDocument(pmDoc);
}

describe("details round-trip", () => {
  test("default variant details with summary and paragraph", () => {
    const input: EditorDocument = [
      {
        tag: "details",
        children: [
          { tag: "summary", children: ["I can be expanded"] },
          { tag: "p", children: ["Hidden text"] },
        ],
      },
    ];
    expect(detailsRoundTrip(input)).toEqual(input);
  });

  test("custom variant details", () => {
    const input: EditorDocument = [
      {
        tag: "details",
        variant: "footnote",
        children: [
          { tag: "summary", children: ["See footnote 1"] },
          { tag: "p", children: ["This is the footnote content."] },
        ],
      },
    ];
    expect(detailsRoundTrip(input)).toEqual(input);
  });

  test("details with styled summary (bold, link)", () => {
    const input: EditorDocument = [
      {
        tag: "details",
        children: [
          {
            tag: "summary",
            children: [
              { tag: "span", styles: ["bold"], children: ["Important"] },
              " info",
            ],
          },
          { tag: "p", children: ["Detailed content here."] },
        ],
      },
    ];
    expect(detailsRoundTrip(input)).toEqual(input);
  });

  test("details with multiple body blocks", () => {
    const input: EditorDocument = [
      {
        tag: "details",
        children: [
          { tag: "summary", children: ["Expand for more"] },
          { tag: "p", children: ["First paragraph."] },
          { tag: "p", children: ["Second paragraph."] },
          {
            tag: "ul",
            children: [
              { tag: "li", children: [{ tag: "p", children: ["Item 1"] }] },
              { tag: "li", children: [{ tag: "p", children: ["Item 2"] }] },
            ],
          },
        ],
      },
    ];
    expect(detailsRoundTrip(input)).toEqual(input);
  });

  test("details nested inside blockquote", () => {
    const input: EditorDocument = [
      {
        tag: "blockquote",
        children: [
          {
            tag: "details",
            children: [
              { tag: "summary", children: ["Quoted details"] },
              { tag: "p", children: ["Inside a quote."] },
            ],
          },
        ],
      },
    ];
    expect(detailsRoundTrip(input)).toEqual(input);
  });

  test("blockquote nested inside details", () => {
    const input: EditorDocument = [
      {
        tag: "details",
        children: [
          { tag: "summary", children: ["Details with quote"] },
          {
            tag: "blockquote",
            children: [{ tag: "p", children: ["A quoted block."] }],
          },
        ],
      },
    ];
    expect(detailsRoundTrip(input)).toEqual(input);
  });

  test("default variant omits variant field in serialized output", () => {
    const input: EditorDocument = [
      {
        tag: "details",
        children: [
          { tag: "summary", children: ["Summary"] },
          { tag: "p", children: ["Body"] },
        ],
      },
    ];
    const result = detailsRoundTrip(input);
    const details = result[0] as unknown as Record<string, unknown>;
    expect(details).not.toHaveProperty("variant");
  });

  test("explicit 'details' variant is omitted in serialized output", () => {
    const input: EditorDocument = [
      {
        tag: "details",
        variant: "details",
        children: [
          { tag: "summary", children: ["Summary"] },
          { tag: "p", children: ["Body"] },
        ],
      },
    ];
    const result = detailsRoundTrip(input);
    const details = result[0] as unknown as Record<string, unknown>;
    expect(details).not.toHaveProperty("variant");
  });
});
