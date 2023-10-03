import { file } from "../source/file";
import { richtext } from "./richtext_v2";

//MD to HTML
describe("richtext", () => {
  test("basic h1", () => {
    const easy = richtext`# Title 1`;
    expect(easy).toStrictEqual([{ tag: "h1", children: ["Title 1"] }]);
  });

  test("basic complete", () => {
    const r = richtext`# Title 1
## Title 2

Paragraph 1 2 3 4 5. Words *italic* **bold**
`;
    expect(r).toStrictEqual([
      { tag: "h1", children: ["Title 1"] },
      { tag: "h2", children: ["Title 2"] },
      {
        tag: "p",
        children: [
          "Paragraph 1 2 3 4 5. Words ",
          { tag: "span", class: ["italic"], children: ["italic"] },
          " ",
          { tag: "span", class: ["font-bold"], children: ["bold"] },
        ],
      },
    ]);
  });

  test.skip("strong and emphasis merged spans", () => {
    // TODO: currently we do not merge
    const r = richtext`Which classes?
***All of them!***
`;
    expect(r).toStrictEqual([
      {
        tag: "p",
        children: [
          "Which classes?\n",
          {
            tag: "span",
            class: ["italic", "font-bold"],
            children: ["All of them!"],
          },
        ],
      },
    ]);
  });

  test("2 paragraphs", () => {
    type Opts = { image: true };
    const r = richtext<Opts>`# Title 1

First paragraph

Second paragraph
`;
    expect(r).toStrictEqual([
      { tag: "h1", children: ["Title 1"] },
      { tag: "p", children: ["First paragraph"] },
      { tag: "p", children: ["Second paragraph"] },
    ]);
  });

  test("lists", () => {
    const r = richtext`# Title 1

A paragraph

A bullet list:
- bullet 1
- bullet 2

A numbered list:
1. number 1
2. number 2

A nested list:
- bullet 1:
    1. number 1.1
    2. number 1.2
- bullet 2:
    - bullet 2.1
    - bullet 2.2
`;
    expect(r).toStrictEqual([
      { tag: "h1", children: ["Title 1"] },
      { tag: "p", children: ["A paragraph"] },
      { tag: "p", children: ["A bullet list:"] },
      {
        tag: "ul",
        children: [
          { tag: "li", children: ["bullet 1"] },
          { tag: "li", children: ["bullet 2"] },
        ],
      },
      { tag: "p", children: ["A numbered list:"] },
      {
        tag: "ol",
        children: [
          { tag: "li", children: ["number 1"] },
          { tag: "li", children: ["number 2"] },
        ],
      },
      { tag: "p", children: ["A nested list:"] },
      {
        tag: "ul",
        children: [
          {
            tag: "li",
            children: [
              "bullet 1:",
              {
                tag: "ol",
                children: [
                  { tag: "li", children: ["number 1.1"] },
                  { tag: "li", children: ["number 1.2"] },
                ],
              },
            ],
          },
          {
            tag: "li",
            children: [
              "bullet 2:",
              {
                tag: "ul",
                children: [
                  { tag: "li", children: ["bullet 2.1"] },
                  { tag: "li", children: ["bullet 2.2"] },
                ],
              },
            ],
          },
        ],
      },
    ]);
  });

  test("image", () => {
    type Opts = { image: true };
    const r = richtext<Opts>`# Title 1

Below we have an image block:

${file("/public/foo.png", {
  width: 100,
  height: 100,
  sha256: "123",
})}`;
    expect(r).toStrictEqual([
      { tag: "h1", children: ["Title 1"] },
      { tag: "p", children: ["Below we have an image block:"] },
      {
        _ref: "/public/foo.png",
        _type: "file",
        metadata: { width: 100, height: 100, sha256: "123" },
      },
    ]);
  });
});
