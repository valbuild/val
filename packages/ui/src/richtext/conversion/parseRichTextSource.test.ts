import { initVal } from "@valbuild/core";
import { parseRichTextSource } from "./parseRichTextSource";

const { val } = initVal();

//MD to HTML
describe("richtext", () => {
  test("basic h1", () => {
    const r = val.richtext`# Title 1`;
    expect(parseRichTextSource(r).children).toStrictEqual([
      { tag: "h1", children: ["Title 1"] },
    ]);
  });

  test("basic complete", () => {
    const r = val.richtext`# Title 1
## Title 2

Paragraph 1 2 3 4 5. Words *italic* **bold**
`;
    expect(parseRichTextSource(r).children).toStrictEqual([
      { tag: "h1", children: ["Title 1"] },
      { tag: "h2", children: ["Title 2"] },
      {
        tag: "p",
        children: [
          "Paragraph 1 2 3 4 5. Words ",
          { tag: "span", classes: ["italic"], children: ["italic"] },
          " ",
          { tag: "span", classes: ["bold"], children: ["bold"] },
        ],
      },
    ]);
  });

  test.skip("strong and emphasis merged spans", () => {
    // TODO: currently we do not merge
    const r = val.richtext`Which classes?
***All of them!***
  `;
    expect(parseRichTextSource(r).children).toStrictEqual([
      {
        tag: "p",
        children: [
          "Which classes?\n",
          {
            tag: "span",
            classes: ["italic", "bold"],
            children: ["All of them!"],
          },
        ],
      },
    ]);
  });

  test("line through", () => {
    // TODO: currently we do not merge
    const r = val.richtext`~~line through~~`;
    expect(parseRichTextSource(r).children).toStrictEqual([
      {
        tag: "p",
        children: [
          {
            tag: "span",
            classes: ["line-through"],
            children: ["line through"],
          },
        ],
      },
    ]);
  });

  test("2 paragraphs", () => {
    const r = val.richtext`# Title 1

First paragraph

Second paragraph
`;
    expect(parseRichTextSource(r).children).toStrictEqual([
      { tag: "h1", children: ["Title 1"] },
      { tag: "p", children: ["First paragraph"] },
      { tag: "p", children: ["Second paragraph"] },
    ]);
  });

  test("basic lists", () => {
    const r = val.richtext`A bullet list:

- bullet 1
- bullet 2
`;
    expect(parseRichTextSource(r).children).toStrictEqual([
      { tag: "p", children: ["A bullet list:"] },
      {
        tag: "ul",
        children: [
          { tag: "li", children: ["bullet 1"] },
          { tag: "li", children: ["bullet 2"] },
        ],
      },
    ]);
  });

  test("lists with line breaks", () => {
    const r = val.richtext`A bullet list:
  
  - bullet 1
  - bullet 2
break this line
  `;
    expect(parseRichTextSource(r).children).toStrictEqual([
      { tag: "p", children: ["A bullet list:"] },
      {
        tag: "ul",
        children: [
          {
            tag: "li",
            children: ["bullet 1"],
          },
          {
            tag: "li",
            children: [
              "bullet 2",
              { tag: "br", children: [] },
              "break this line",
            ],
          },
        ],
      },
    ]);
  });

  test("lists", () => {
    const r = val.richtext`# Title 1

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
    expect(parseRichTextSource(r).children).toStrictEqual([
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
    const r = val.richtext`# Title 1

Below we have an image block:

${val.file("/public/foo.png", {
  width: 100,
  height: 100,
  sha256: "123",
})}`;
    expect(parseRichTextSource(r).children).toStrictEqual([
      { tag: "h1", children: ["Title 1"] },
      { tag: "p", children: ["Below we have an image block:"] },
      {
        tag: "p",
        children: [
          {
            src: "/foo.png?sha256=123",
            tag: "img",
            width: 100,
            height: 100,
            children: [],
          },
        ],
      },
    ]);
  });

  test("block link", () => {
    const r = val.richtext`# Title 1

Below we have a url:

${val.link("google", { href: "https://google.com" })}`;
    expect(parseRichTextSource(r).children).toStrictEqual([
      { tag: "h1", children: ["Title 1"] },
      { tag: "p", children: ["Below we have a url:"] },
      {
        tag: "p",
        children: [
          {
            tag: "a",
            href: "https://google.com",
            children: ["google"],
          },
        ],
      },
    ]);
  });

  test("inline link", () => {
    const r = val.richtext`# Title 1

Below we have a url: ${val.link("google", { href: "https://google.com" })}`;
    expect(parseRichTextSource(r).children).toStrictEqual([
      { tag: "h1", children: ["Title 1"] },
      {
        tag: "p",
        children: [
          "Below we have a url: ",
          {
            href: "https://google.com",
            tag: "a",
            children: ["google"],
          },
        ],
      },
    ]);
  });

  test("inline link with bold", () => {
    const r = val.richtext`# Title 1

Inline link -> ${val.link("**google**", { href: "https://google.com" })}`;

    // source:
    expect(parseRichTextSource(r).children).toStrictEqual([
      { tag: "h1", children: ["Title 1"] },
      {
        tag: "p",
        children: [
          "Inline link -&gt; ",
          {
            href: "https://google.com",
            tag: "a",
            children: [
              {
                tag: "span",
                classes: ["bold"],
                children: ["google"],
              },
            ],
          },
        ],
      },
    ]);
  });

  test("breaks", () => {
    const r = val.richtext`
# Title 1

Foo

<br>

Bar
`;
    // source:
    expect(parseRichTextSource(r).children).toStrictEqual([
      { tag: "h1", children: ["Title 1"] },
      {
        tag: "p",
        children: ["Foo"],
      },
      {
        tag: "br",
        children: [],
      },
      {
        tag: "p",
        children: ["Bar"],
      },
    ]);
  });
});
