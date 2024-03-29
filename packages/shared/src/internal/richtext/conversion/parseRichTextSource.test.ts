import { initVal } from "@valbuild/core";
import { parseRichTextSource } from "./parseRichTextSource";

const { c } = initVal();

//MD to HTML
describe("richtext", () => {
  test("basic h1", () => {
    const r = c.richtext`# Title 1`;
    expect(parseRichTextSource(r).children).toStrictEqual([
      { tag: "h1", children: ["Title 1"] },
    ]);
  });

  test("basic complete", () => {
    const r = c.richtext`# Title 1
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

  test("strong and emphasis merged spans", () => {
    const r = c.richtext`Which classes?
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
    const r = c.richtext`~~line through~~`;
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
    const r = c.richtext`# Title 1

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
    const r = c.richtext`A bullet list:

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
    const r = c.richtext`A bullet list:
  
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
            children: ["bullet 2", { tag: "br" }, "break this line"],
          },
        ],
      },
    ]);
  });

  test("special chars", () => {
    const r = c.richtext`# "Title 1"

Beautiful "quotes" and 'single quotes'

Some crocodiles: < >

Ampersand: &

  `;
    expect(parseRichTextSource(r).children).toStrictEqual([
      { tag: "h1", children: ['"Title 1"'] },
      { tag: "p", children: [`Beautiful "quotes" and 'single quotes'`] },
      { tag: "p", children: ["Some crocodiles: < >"] },
      { tag: "p", children: ["Ampersand: &"] },
    ]);
  });

  test("lists", () => {
    const r = c.richtext`# Title 1

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

  test("br tokens", () => {
    const r = c.richtext`1 år 400,- kinokveld  
5 år 5000,- en kveld i tretoppene`;
    expect(parseRichTextSource(r).children).toStrictEqual([
      {
        tag: "p",
        children: [
          "1 år 400,- kinokveld",
          { tag: "br" },
          "5 år 5000,- en kveld i tretoppene",
        ],
      },
    ]);
  });

  test("multiple br tokens", () => {
    const r = c.richtext`1 år 400,- kinokveld  
2 år 1000,- kulturell opplevelse  
3 år 2000,- mat i fjeset  
4 år 500,- nørding i bokhandel  
5 år 5000,- en kveld i tretoppene  
6 år 1200,- ta smaksløkene på trim  
7 år 2500,- gjør en forskjell`;
    expect(parseRichTextSource(r).children).toStrictEqual([
      {
        tag: "p",
        children: [
          "1 år 400,- kinokveld",
          { tag: "br" },
          "2 år 1000,- kulturell opplevelse",
          { tag: "br" },
          "3 år 2000,- mat i fjeset",
          { tag: "br" },
          "4 år 500,- nørding i bokhandel",
          { tag: "br" },
          "5 år 5000,- en kveld i tretoppene",
          { tag: "br" },
          "6 år 1200,- ta smaksløkene på trim",
          { tag: "br" },
          "7 år 2500,- gjør en forskjell",
        ],
      },
    ]);
  });

  test("image", () => {
    const r = c.richtext`# Title 1

Below we have an image block:

${c.file("/public/foo.png", {
  width: 100,
  height: 100,
  sha256: "123",
  mimeType: "image/png",
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
            mimeType: "image/png",
          },
        ],
      },
    ]);
  });

  test("markdown link", () => {
    const r = c.richtext`# Title 1

Below we have a url: [google](https://google.com)`;
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

  test("block link", () => {
    const r = c.richtext`# Title 1

Below we have a url:

${c.rt.link("google", { href: "https://google.com" })}`;
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
    const r = c.richtext`# Title 1

Below we have a url: ${c.rt.link("google", { href: "https://google.com" })}`;
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
    const r = c.richtext`# Title 1

Inline link -> ${c.rt.link("**google**", { href: "https://google.com" })}`;

    // source:
    expect(parseRichTextSource(r).children).toStrictEqual([
      { tag: "h1", children: ["Title 1"] },
      {
        tag: "p",
        children: [
          "Inline link -> ",
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

  test("https:// in link description", () => {
    const r = c.richtext`# Title 1

Inline link -> ${c.rt.link("https://google.com", {
      href: "https://google.com",
    })}`;

    expect(parseRichTextSource(r).children).toStrictEqual([
      { tag: "h1", children: ["Title 1"] },
      {
        tag: "p",
        children: [
          "Inline link -> ",
          {
            tag: "a",
            href: "https://google.com",
            children: ["https://google.com"],
          },
        ],
      },
    ]);
  });

  test("auto link does nothing", () => {
    const r = c.richtext`# Title 1

No transform here -> https://google.com

Transform this:
[https://google.com](https://google.com)
`;

    expect(parseRichTextSource(r).children).toStrictEqual([
      { tag: "h1", children: ["Title 1"] },
      {
        tag: "p",
        children: ["No transform here -> ", "https://google.com"],
      },
      {
        tag: "p",
        children: [
          "Transform this:\n",
          {
            tag: "a",
            href: "https://google.com",
            children: ["https://google.com"],
          },
        ],
      },
    ]);
  });

  test("breaks", () => {
    const r = c.richtext`
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
      },
      {
        tag: "p",
        children: ["Bar"],
      },
    ]);
  });
  test("list with formatting and breaks", () => {
    const r = c.richtext`
# Title 1

- Item _one_
- Item **two**
- Item ***two***
- With breaks:
    1. Formatted **list**
Test 123
- With links: ${c.rt.link("**link**", { href: "https://link.com" })}
`;
    // source:
    expect(parseRichTextSource(r).children).toStrictEqual([
      {
        tag: "h1",
        children: ["Title 1"],
      },
      {
        tag: "ul",
        children: [
          {
            tag: "li",
            children: [
              "Item ",
              {
                tag: "span",
                classes: ["italic"],
                children: ["one"],
              },
            ],
          },
          {
            tag: "li",
            children: [
              "Item ",
              {
                tag: "span",
                classes: ["bold"],
                children: ["two"],
              },
            ],
          },
          {
            tag: "li",
            children: [
              "Item ",
              {
                tag: "span",
                classes: ["italic", "bold"],
                children: ["two"],
              },
            ],
          },
          {
            tag: "li",
            children: [
              "With breaks:",
              {
                tag: "ol",
                children: [
                  {
                    tag: "li",
                    children: [
                      "Formatted ",
                      {
                        tag: "span",
                        classes: ["bold"],
                        children: ["list"],
                      },
                      {
                        tag: "br",
                      },
                      "Test 123",
                    ],
                  },
                ],
              },
            ],
          },
          {
            tag: "li",
            children: [
              "With links: ",
              {
                tag: "a",
                href: "https://link.com",
                children: [
                  {
                    tag: "span",
                    classes: ["bold"],
                    children: ["link"],
                  },
                ],
              },
            ],
          },
        ],
      },
    ]);
  });
});
