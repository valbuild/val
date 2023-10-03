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

  // @see skipped test: "strong and emphasis merged spans" and replace this test with this one
  test("strong and emphasis (unmerged)", () => {
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
            class: ["italic"],
            children: [
              {
                tag: "span",
                class: ["font-bold"],
                children: ["All of them!"],
              },
            ],
          },
        ],
      },
    ]);
  });
});
