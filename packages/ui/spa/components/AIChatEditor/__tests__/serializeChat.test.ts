import type { SourcePath } from "@valbuild/core";
import { buildChatSchema } from "../schema/buildChatSchema";
import { parseChatDocument } from "../serialize/parseChatDocument";
import { serializeChatDocument } from "../serialize/serializeChatDocument";
import { chatDocumentToHtmlText } from "../serialize/chatDocumentToHtmlText";
import {
  collectImageKeysFromDoc,
  collectImageNodesFromDoc,
} from "../serialize/collectImageKeysFromDoc";
import type { ChatDocument } from "../types";

const schema = buildChatSchema();

function roundTrip(doc: ChatDocument): ChatDocument {
  const pm = parseChatDocument(doc, schema);
  return serializeChatDocument(pm);
}

describe("serializeChatDocument / parseChatDocument round-trip", () => {
  it("empty document materializes a single empty paragraph", () => {
    const out = roundTrip([]);
    expect(out).toEqual([{ tag: "p", children: [] }]);
  });

  it("preserves a plain paragraph", () => {
    const doc: ChatDocument = [{ tag: "p", children: ["hello world"] }];
    expect(roundTrip(doc)).toEqual(doc);
  });

  it("preserves headings h1/h2/h3", () => {
    const doc: ChatDocument = [
      { tag: "h1", children: ["title"] },
      { tag: "h2", children: ["subtitle"] },
      { tag: "h3", children: ["section"] },
    ];
    expect(roundTrip(doc)).toEqual(doc);
  });

  it("preserves marks (bold, italic, line-through, code)", () => {
    const doc: ChatDocument = [
      {
        tag: "p",
        children: [
          "plain ",
          { tag: "span", styles: ["bold"], children: ["bold"] },
          " ",
          { tag: "span", styles: ["italic"], children: ["italic"] },
          " ",
          { tag: "span", styles: ["line-through"], children: ["strike"] },
          " ",
          { tag: "span", styles: ["code"], children: ["code"] },
        ],
      },
    ];
    expect(roundTrip(doc)).toEqual(doc);
  });

  it("preserves hard breaks", () => {
    const doc: ChatDocument = [
      { tag: "p", children: ["line 1", { tag: "br" }, "line 2"] },
    ];
    expect(roundTrip(doc)).toEqual(doc);
  });

  it("preserves bullet and ordered lists", () => {
    const doc: ChatDocument = [
      {
        tag: "ul",
        children: [
          { tag: "li", children: [{ tag: "p", children: ["alpha"] }] },
          { tag: "li", children: [{ tag: "p", children: ["beta"] }] },
        ],
      },
      {
        tag: "ol",
        children: [
          { tag: "li", children: [{ tag: "p", children: ["one"] }] },
          { tag: "li", children: [{ tag: "p", children: ["two"] }] },
        ],
      },
    ];
    expect(roundTrip(doc)).toEqual(doc);
  });

  it("preserves blockquote", () => {
    const doc: ChatDocument = [
      {
        tag: "blockquote",
        children: [{ tag: "p", children: ["quoted text"] }],
      },
    ];
    expect(roundTrip(doc)).toEqual(doc);
  });

  it("preserves image nodes with key + metadata", () => {
    const doc: ChatDocument = [
      {
        tag: "p",
        children: [
          "look: ",
          {
            tag: "img",
            key: "abc123",
            alt: "a cat",
            previewUrl: "blob:xyz",
            width: 320,
            height: 240,
            mimeType: "image/png",
          },
        ],
      },
    ];
    expect(roundTrip(doc)).toEqual(doc);
  });

  it("preserves field_ref nodes", () => {
    const path = "/content/blogs.val.ts?p=0.title" as SourcePath;
    const doc: ChatDocument = [
      {
        tag: "p",
        children: ["change ", { tag: "field_ref", path }],
      },
    ];
    expect(roundTrip(doc)).toEqual(doc);
  });
});

describe("chatDocumentToHtmlText", () => {
  it("renders a simple paragraph", () => {
    expect(chatDocumentToHtmlText([{ tag: "p", children: ["hello"] }])).toBe(
      "<p>hello</p>",
    );
  });

  it("escapes <, > and & in text", () => {
    expect(
      chatDocumentToHtmlText([
        { tag: "p", children: ['<script>alert("x") & co</script>'] },
      ]),
    ).toBe('<p>&lt;script&gt;alert("x") &amp; co&lt;/script&gt;</p>');
  });

  it("emits inline marks as HTML tags", () => {
    expect(
      chatDocumentToHtmlText([
        {
          tag: "p",
          children: [
            { tag: "span", styles: ["bold"], children: ["b"] },
            { tag: "span", styles: ["italic"], children: ["i"] },
            { tag: "span", styles: ["line-through"], children: ["s"] },
            { tag: "span", styles: ["code"], children: ["c"] },
          ],
        },
      ]),
    ).toBe("<p><strong>b</strong><em>i</em><del>s</del><code>c</code></p>");
  });

  it("renders headings, blockquote, lists and br", () => {
    const doc: ChatDocument = [
      { tag: "h1", children: ["Title"] },
      { tag: "blockquote", children: [{ tag: "p", children: ["q"] }] },
      {
        tag: "ul",
        children: [
          {
            tag: "li",
            children: [{ tag: "p", children: ["x", { tag: "br" }, "y"] }],
          },
        ],
      },
      {
        tag: "ol",
        children: [{ tag: "li", children: [{ tag: "p", children: ["one"] }] }],
      },
    ];
    expect(chatDocumentToHtmlText(doc)).toBe(
      "<h1>Title</h1>\n<blockquote><p>q</p></blockquote>\n<ul><li><p>x<br/>y</p></li></ul>\n<ol><li><p>one</p></li></ol>",
    );
  });

  it("renders image with key (escaping attr) and optional alt", () => {
    expect(
      chatDocumentToHtmlText([
        {
          tag: "p",
          children: [
            { tag: "img", key: 'k"&<>', alt: 'a "cat"' },
            { tag: "img", key: "plain" },
          ],
        },
      ]),
    ).toBe(
      '<p><img key="k&quot;&amp;&lt;&gt;" alt="a &quot;cat&quot;"/><img key="plain"/></p>',
    );
  });

  it("renders field_ref as a self-closing tag with attr escaping", () => {
    const path = '/content/foo.val.ts?p="bar"' as SourcePath;
    expect(
      chatDocumentToHtmlText([
        { tag: "p", children: [{ tag: "field_ref", path }] },
      ]),
    ).toBe('<p><field path="/content/foo.val.ts?p=&quot;bar&quot;"/></p>');
  });
});

describe("collectImageKeysFromDoc", () => {
  it("returns no keys for a doc without images", () => {
    const doc: ChatDocument = [{ tag: "p", children: ["just text"] }];
    expect(collectImageKeysFromDoc(doc)).toEqual([]);
  });

  it("collects keys from a flat paragraph in document order", () => {
    const doc: ChatDocument = [
      {
        tag: "p",
        children: [
          "see ",
          { tag: "img", key: "a", previewUrl: "blob:1" },
          " and ",
          { tag: "img", key: "b", previewUrl: "blob:2" },
        ],
      },
    ];
    expect(collectImageKeysFromDoc(doc)).toEqual(["a", "b"]);
  });

  it("walks into blockquote, ul and ol", () => {
    const doc: ChatDocument = [
      {
        tag: "blockquote",
        children: [{ tag: "p", children: [{ tag: "img", key: "in-bq" }] }],
      },
      {
        tag: "ul",
        children: [
          {
            tag: "li",
            children: [{ tag: "p", children: [{ tag: "img", key: "in-ul" }] }],
          },
        ],
      },
      {
        tag: "ol",
        children: [
          {
            tag: "li",
            children: [{ tag: "p", children: [{ tag: "img", key: "in-ol" }] }],
          },
        ],
      },
    ];
    expect(collectImageKeysFromDoc(doc)).toEqual(["in-bq", "in-ul", "in-ol"]);
  });

  it("returns full image nodes via collectImageNodesFromDoc", () => {
    const doc: ChatDocument = [
      {
        tag: "p",
        children: [
          {
            tag: "img",
            key: "k1",
            alt: "cat",
            previewUrl: "blob:cat",
            width: 100,
            height: 50,
            mimeType: "image/png",
          },
        ],
      },
    ];
    expect(collectImageNodesFromDoc(doc)).toEqual([
      {
        tag: "img",
        key: "k1",
        alt: "cat",
        previewUrl: "blob:cat",
        width: 100,
        height: 50,
        mimeType: "image/png",
      },
    ]);
  });

  it("preserves both pending: and real keys (filtering is caller's job)", () => {
    const doc: ChatDocument = [
      {
        tag: "p",
        children: [
          { tag: "img", key: "pending:abc" },
          { tag: "img", key: "real-key" },
        ],
      },
    ];
    expect(collectImageKeysFromDoc(doc)).toEqual(["pending:abc", "real-key"]);
  });
});

describe("buildChatSchema image node spec", () => {
  it("has exactly one parseDOM rule (the data-val-ai-key one)", () => {
    // Sanity: the old `img[src]` fallback minted stale pending: keys via
    // Math.random() and was the source of the 404 "Session file(s) not found"
    // bug. It has been removed. Paste/drop handlers fetch HTML <img src> and
    // run them through insertImageWithUpload so a real key is always assigned.
    const imageSpec = schema.nodes.image.spec;
    const rules = imageSpec.parseDOM ?? [];
    expect(rules).toHaveLength(1);
    expect(rules[0].tag).toBe("img[data-val-ai-key]");
  });
});
