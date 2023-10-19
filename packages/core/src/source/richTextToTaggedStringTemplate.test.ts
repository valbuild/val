import { file } from "./file";
import { link } from "./link";
import {
  AnyRichTextOptions,
  internalRichText,
  RichTextSource,
} from "./richtext";
import { richTextToTaggedStringTemplate } from "./richTextToTaggedStringTemplate";

describe("patch richtext", () => {
  test("basic richtext <-> markdown", () => {
    const input: RichTextSource<AnyRichTextOptions> = {
      _type: "richtext",
      children: [
        { tag: "h1", children: ["Title 1"] },
        {
          tag: "p",
          children: [
            {
              tag: "span",
              classes: ["bold"],
              children: ["Bold text"],
            },
            " ",
            {
              _type: "link",
              href: "https://link.com",
              children: ["**Link**"],
            },
          ],
        },
        {
          tag: "p",
          children: [
            {
              _type: "file",
              _ref: "/public/image.png",
              metadata: { width: 200, height: 200, sha256: "123" },
            },
          ],
        },
        { tag: "p", children: ["Paragraph 2"] },
      ],
    };
    const r = richTextToTaggedStringTemplate(input);
    expect(r).toStrictEqual([
      ["# Title 1\n\n**Bold text** ", "\n\n", "\n\n\nParagraph 2"],
      [
        link("**Link**", { href: "https://link.com" }),
        file("/public/image.png", { width: 200, height: 200, sha256: "123" }),
      ],
    ]);
    const r2 = internalRichText(r[0], ...r[1]);
    console.log(JSON.stringify(r2, null, 2));
    expect(r2).toStrictEqual(input);
  });

  test.skip("richtext <-> markdown", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const input: any = {
      _type: "richtext",
      children: [
        { tag: "h1", children: ["Title 1"] },
        { tag: "h2", children: ["Title 2"] },
        {
          tag: "p",
          children: [
            "Test 1 2 3. ",
            {
              tag: "span",
              classes: ["bold"],
              children: ["Bold text"],
            },
            ". More text. See image below",
          ],
        },
        { _type: "file", _ref: "/public/image.png" },
        { tag: "p", children: ["Paragraph 2"] },
        {
          tag: "ol",
          children: [
            { tag: "li", children: ["OL:Item 1"] },
            { tag: "li", children: ["OL:Item 2"] },
          ],
        },
        {
          tag: "ul",
          children: [
            { tag: "li", children: ["UL:Item 2"] },
            { tag: "li", children: ["UL:Item 3"] },
          ],
        },
        { tag: "h3", children: ["Title 3"] },
        { _type: "link", href: "https://example.com", children: [] },
        { tag: "br", children: [] },
        { tag: "br", children: [] },
        { tag: "br", children: [] },
        {
          tag: "ul",
          children: [
            {
              tag: "li",
              children: [
                { tag: "span", classes: ["bold"], children: ["UL:Item 4"] },
              ],
            },
          ],
        },
      ],
    };
    const r = richTextToTaggedStringTemplate(input);
    const r2 = internalRichText(r[0], ...r[1]);
    expect(r2).toStrictEqual(input);
  });
});
