import { richtext } from "./richtext_v2";

//MD to HTML
describe("richtext", () => {
  test("todo", () => {
    const easy = richtext`# Title 1`;
    expect(easy).toStrictEqual([{ tag: "h1", children: ["Title 1"] }]);
  }),
    test("todo", () => {
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
});
