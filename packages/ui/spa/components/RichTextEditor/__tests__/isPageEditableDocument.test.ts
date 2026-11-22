import { isPageEditableDocument } from "../isPageEditableDocument";

describe("a document that can be edited on the page", () => {
  test("paragraphs, headings, lists, marks, links, breaks and images", () => {
    expect(
      isPageEditableDocument([
        { tag: "h2", children: ["Who we are"] },
        {
          tag: "p",
          children: [
            "We are ",
            { tag: "span", styles: ["bold"], children: ["forty"] },
            { tag: "br" },
            { tag: "a", href: "/jobs", children: ["Join us"] },
            { tag: "img", src: { path: "/public/val/us.png" } },
          ],
        },
        {
          tag: "ol",
          children: [
            {
              tag: "li",
              children: [
                { tag: "p", children: ["Oslo"] },
                { tag: "ul", children: [] },
              ],
            },
          ],
        },
      ]),
    ).toBe(true);
    expect(isPageEditableDocument([])).toBe(true);
  });

  test("nothing else", () => {
    for (const document of [
      "We are forty",
      [{ tag: "blockquote", children: [{ tag: "p", children: [] }] }],
      [{ tag: "p" }],
      [{ tag: "p", children: [{ tag: "button", variant: "cta" }] }],
      [{ tag: "p", children: [{ tag: "span", children: ["no styles"] }] }],
      [{ tag: "p", children: [{ tag: "a", children: ["no href"] }] }],
      [{ tag: "ul", children: [{ tag: "p", children: [] }] }],
      [{ tag: "li", children: [] }],
      ["bare text"],
    ]) {
      expect(isPageEditableDocument(document)).toBe(false);
    }
  });
});
