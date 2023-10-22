import {
  AnyRichTextOptions,
  FileSource,
  ImageMetadata,
  LinkSource,
  RichText,
  RichTextSource,
  initVal,
} from "@valbuild/core";
import {
  COMMON_LEXICAL_PROPS,
  fromLexicalFormat,
  LexicalRootNode,
  toLexical,
  toLexicalFormat,
} from "./conversion";
import { fromLexical } from "./fromLexical";
import { parseRichTextSource } from "./parseRichTextSource";

describe("richtext conversion", () => {
  test("format conversion", () => {
    //
    expect(toLexicalFormat([])).toStrictEqual(0);
    expect(toLexicalFormat(["bold"])).toStrictEqual(1);
    expect(toLexicalFormat(["italic"])).toStrictEqual(2);
    expect(toLexicalFormat(["bold", "italic"])).toStrictEqual(3);
    expect(toLexicalFormat(["line-through"])).toStrictEqual(4);
    expect(toLexicalFormat(["bold", "line-through"])).toStrictEqual(5);
    expect(toLexicalFormat(["italic", "line-through"])).toStrictEqual(6);
    expect(toLexicalFormat(["bold", "italic", "line-through"])).toStrictEqual(
      7
    );
    //
    expect(fromLexicalFormat(0)).toStrictEqual([]);
    expect(fromLexicalFormat(1)).toStrictEqual(["bold"]);
    expect(fromLexicalFormat(2)).toStrictEqual(["italic"]);
    expect(fromLexicalFormat(3)).toStrictEqual(["bold", "italic"]);
    expect(fromLexicalFormat(4)).toStrictEqual(["line-through"]);
    expect(fromLexicalFormat(5)).toStrictEqual(["bold", "line-through"]);
    expect(fromLexicalFormat(6)).toStrictEqual(["italic", "line-through"]);
    expect(fromLexicalFormat(7)).toStrictEqual([
      "bold",
      "italic",
      "line-through",
    ]);
  });
  test("basic lexical text conversion to <-> from", async () => {
    const input: RichText<AnyRichTextOptions> = {
      _type: "richtext",
      children: [
        { tag: "h1", children: ["Title 1"] },
        { tag: "h2", children: ["Title 2"] },
        { tag: "h3", children: ["Title 3"] },
        { tag: "h4", children: ["Title 4"] },
        { tag: "h5", children: ["Title 5"] },
        { tag: "h6", children: ["Title 6"] },
        {
          tag: "p",
          children: [
            {
              tag: "span",
              classes: ["bold", "italic", "line-through"],
              children: ["Formatted span"],
            },
          ],
        },
        { tag: "br", children: [] },
        { tag: "br", children: [] },
        {
          tag: "p",
          children: [
            { tag: "a", href: "https://example.com", children: ["Link"] },
          ],
        },
        {
          tag: "ul",
          children: [
            {
              tag: "li",
              children: [
                {
                  tag: "ol",
                  dir: "rtl",
                  children: [
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "span",
                          classes: ["italic"],
                          children: ["number 1.1"],
                        },
                      ],
                    },
                    { tag: "li", children: ["number 1.2"] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const output1: LexicalRootNode = {
      version: 1,
      format: "",
      indent: 0,
      direction: null,
      type: "root",
      children: [
        {
          version: 1,
          format: "",
          indent: 0,
          direction: null,
          type: "heading",
          tag: "h1",
          children: [
            {
              version: 1,
              format: "",
              indent: 0,
              direction: null,
              type: "text",
              text: "Title 1",
            },
          ],
        },
        {
          version: 1,
          format: "",
          indent: 0,
          direction: null,
          type: "heading",
          tag: "h2",
          children: [
            {
              version: 1,
              format: "",
              indent: 0,
              direction: null,
              type: "text",
              text: "Title 2",
            },
          ],
        },
        {
          version: 1,
          format: "",
          indent: 0,
          direction: null,
          type: "heading",
          tag: "h3",
          children: [
            {
              version: 1,
              format: "",
              indent: 0,
              direction: null,
              type: "text",
              text: "Title 3",
            },
          ],
        },
        {
          version: 1,
          format: "",
          indent: 0,
          direction: null,
          type: "heading",
          tag: "h4",
          children: [
            {
              version: 1,
              format: "",
              indent: 0,
              direction: null,
              type: "text",
              text: "Title 4",
            },
          ],
        },
        {
          version: 1,
          format: "",
          indent: 0,
          direction: null,
          type: "heading",
          tag: "h5",
          children: [
            {
              version: 1,
              format: "",
              indent: 0,
              direction: null,
              type: "text",
              text: "Title 5",
            },
          ],
        },
        {
          version: 1,
          format: "",
          indent: 0,
          direction: null,
          type: "heading",
          tag: "h6",
          children: [
            {
              version: 1,
              format: "",
              indent: 0,
              direction: null,
              type: "text",
              text: "Title 6",
            },
          ],
        },
        {
          version: 1,
          format: "",
          indent: 0,
          direction: null,
          type: "paragraph",
          children: [
            {
              version: 1,
              format: 7,
              indent: 0,
              direction: null,
              type: "text",
              text: "  Formatted span   ",
            },
          ],
        },
        {
          version: 1,
          format: "",
          indent: 0,
          direction: null,
          type: "paragraph",
          children: [],
        },
        {
          version: 1,
          format: "",
          indent: 0,
          direction: null,
          type: "paragraph",
          children: [],
        },
        {
          version: 1,
          format: "",
          indent: 0,
          direction: null,
          type: "paragraph",
          children: [
            {
              version: 1,
              format: "",
              indent: 0,
              direction: null,
              type: "link",
              url: "https://example.com",
              children: [
                {
                  version: 1,
                  format: 7,
                  indent: 0,
                  direction: null,
                  type: "text",
                  text: "Link",
                },
              ],
            },
          ],
        },
        {
          version: 1,
          format: "",
          indent: 0,
          direction: null,
          type: "list",
          listType: "bullet",
          children: [
            {
              version: 1,
              format: "",
              indent: 0,
              direction: null,
              type: "listitem",
              children: [
                {
                  version: 1,
                  format: 2,
                  indent: 0,
                  direction: null,
                  type: "text",
                  text: "number 1.1",
                },
                {
                  version: 1,
                  format: 2,
                  indent: 0,
                  direction: null,
                  type: "link",
                  url: "https://google.com",
                  children: [
                    {
                      version: 1,
                      format: 2,
                      indent: 0,
                      direction: null,
                      type: "text",
                      text: "number 1.1",
                    },
                  ],
                },
              ],
            },
            {
              version: 1,
              format: "",
              indent: 0,
              direction: null,
              type: "listitem",
              children: [
                {
                  version: 1,
                  format: "",
                  indent: 0,
                  direction: "rtl",
                  type: "list",
                  listType: "number",
                  children: [
                    {
                      version: 1,
                      format: "",
                      indent: 0,
                      direction: null,
                      type: "listitem",

                      children: [
                        {
                          version: 1,
                          format: 2,
                          indent: 0,
                          direction: null,
                          type: "list",

                          listType: "bullet",
                          children: [
                            {
                              version: 1,
                              format: "",
                              indent: 0,
                              direction: null,
                              type: "listitem",
                              children: [
                                {
                                  version: 1,
                                  format: 2,
                                  indent: 0,
                                  direction: null,
                                  type: "text",
                                  text: "number 2.1",
                                },
                              ],
                            },
                            {
                              version: 1,
                              format: "",
                              indent: 0,
                              direction: null,
                              type: "listitem",
                              children: [
                                {
                                  version: 1,
                                  format: "",
                                  indent: 0,
                                  direction: null,
                                  type: "text",
                                  text: "number 2.2",
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    // console.log(JSON.stringify(toLexical(input), null, 2));
    // expect(toLexical(input)).toStrictEqual(output);

    const res = await fromLexical(output1);
    let lines = "";
    for (let i = 0; i < res.templateStrings.length; i++) {
      const line = res.templateStrings[i];
      const expr = res.nodes[i];
      lines += line;
      if (expr) {
        lines += "${val." + expr._type + "(" + expr + "})";
      }
    }
    console.log("EOF>>" + lines + "<<EOF");

    // console.log(JSON.stringify(, null, 2));
  });

  test("todo", async () => {
    const { val } = initVal();
    const inputSource = val.richtext`
# Test

### Jippi

${val.file("/test.jpg?sha256=123", {
  width: 100,
  height: 100,
  sha256: "123",
})}

<br><br>

- test 1: ${val.link("**link**", { href: "https://link.com" })}
- test 2
- number 1.1
-  
    1. number 2.1
    1. number 2.2
    1. number 2.3
    1.
        - Test
    `;

    // console.log(JSON.stringify(parseRichTextSource(inputSource), null, 2));
    // console.log(
    //   JSON.stringify(toLexical(parseRichTextSource(inputSource)), null, 2)
    // );
    // console.log(
    //   JSON.stringify(
    //     await fromLexical(toLexical(parseRichTextSource(inputSource))),
    //     null,
    //     2
    //   )
    // );
    const res = await fromLexical(toLexical(parseRichTextSource(inputSource)));
    let lines = "";
    for (let i = 0; i < res.templateStrings.length; i++) {
      const line = res.templateStrings[i];
      const expr = res.nodes[i];
      lines += line;
      if (expr) {
        // TODO: not actually correct, but this is just for debug
        lines += "${val.ext(" + JSON.stringify(expr) + "})";
      }
    }
    console.log("EOF>>" + lines + "<<EOF");
  });

  // // Uncertain whether Val RichText text nodes should allow nested spans - remove this test if that is not the case anymore
  // test("merged lexical text nodes to <-> from", async () => {
  //   const input: RichText<AnyRichTextOptions> = {
  //     _type: "richtext",
  //     children: [
  //       {
  //         tag: "p",
  //         children: [
  //           {
  //             tag: "span",
  //             classes: ["bold", "line-through"],
  //             children: [
  //               {
  //                 tag: "span",
  //                 classes: ["italic"],
  //                 children: ["Formatted nested span"],
  //               },
  //             ],
  //           },
  //         ],
  //       },
  //     ],
  //   };

  //   // See inline comments for what changed between input / output
  //   const output: RichText<AnyRichTextOptions> = {
  //     _type: "richtext",
  //     children: [
  //       {
  //         tag: "p",
  //         children: [
  //           {
  //             tag: "span",
  //             classes: ["bold", "italic", "line-through"], // NOTE: classes was merged
  //             children: ["Formatted nested span"],
  //           },
  //         ],
  //       },
  //     ],
  //   };

  //   expect((await fromLexical(toLexical(input))).node).toStrictEqual(output);
  // });
});

function testRt(
  s: TemplateStringsArray,
  ...exprs: (FileSource<ImageMetadata> | LinkSource)[]
) {
  return [s, exprs] as const;
}
