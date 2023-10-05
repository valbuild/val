import { initVal } from "@valbuild/core";
import { richTextToTaggedStringTemplate } from "./richtext";

describe("patch richtext", () => {
  test("basic richtext <-> markdown", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const input: any = {
      _type: "richtext",
      children: [
        { tag: "h1", children: ["Title 1"] },
        {
          tag: "p",
          children: [
            {
              tag: "span",
              class: ["font-bold"],
              children: ["Bold text"],
            },
          ],
        },
        { _type: "file", _ref: "/public/image.png" },
        { tag: "p", children: ["Paragraph 2"] },
      ],
    };
    const r = richTextToTaggedStringTemplate(input);
    expect(r).toStrictEqual([
      ["# Title 1\n\n*Bold text*\n\n", "\nParagraph 2"],
      [{ _type: "file", _ref: "/public/image.png" }],
    ]);

    const { val } = initVal();
    const r2 = val.richtext(
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      r[0],
      ...r[1]
    );
    expect(r2).toStrictEqual(input);
  });

  test("richtext <-> markdown", () => {
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
              class: ["font-bold"],
              children: ["Bold text"],
            },
            ". More text. See image below",
          ],
        },
        { _type: "file", _ref: "/public/image.png" },
        { tag: "p", children: ["Paragraph 2"] },
      ],
    };
    const r = richTextToTaggedStringTemplate(input);
    const { val } = initVal();
    const r2 = val.richtext(
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      r[0],
      ...r[1]
    );
    expect(r2).toStrictEqual(input);
  });
});
