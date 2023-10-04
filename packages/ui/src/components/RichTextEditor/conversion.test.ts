import { AnyRichTextOptions, RichText } from "@valbuild/core";
import { fromLexicalNode, toLexicalNode } from "./conversion";
import { createHeadlessEditor } from "@lexical/headless";
import { $getRoot, $createParagraphNode, $createTextNode } from "lexical";

const editor = createHeadlessEditor({
  nodes: [],
  onError: (data) => {
    console.error(`Error: ${data.message}`);
  },
});
describe("richtext conversion", () => {
  test("basic from <-> to", () => {
    const input: RichText<AnyRichTextOptions> = {
      _type: "richtext",
      children: [
        {
          tag: "p",
          children: [
            {
              tag: "span",
              class: ["font-bold", "italic", "line-through"],
              children: ["Formatted span"],
            },
          ],
        },
        // { tag: "h1", children: ["Title 1"] },
        // { tag: "h2", children: ["Title 2"] },
        // { tag: "h3", children: ["Title 3"] },
        // { tag: "h4", children: ["Title 4"] },
        // { tag: "h5", children: ["Title 5"] },
        // { tag: "h6", children: ["Title 6"] },
        // {
        //   tag: "p",
        //   children: [
        //     {
        //       tag: "span",
        //       class: ["font-bold", "italic", "line-through"],
        //       children: ["Formatted span"],
        //     },
        //   ],
        // },
        // {
        //   tag: "ul",
        //   children: [
        //     {
        //       tag: "li",
        //       children: [
        //         {
        //           tag: "ol",
        //           children: [
        //             { tag: "li", children: ["number 1.1"] },
        //             { tag: "li", children: ["number 1.2"] },
        //           ],
        //         },
        //       ],
        //     },
        //   ],
        // },
      ],
    };

    editor.update(() => {
      $getRoot().append(
        $createParagraphNode().append($createTextNode("Hello world"))
      );
    });
    console.log(editor.toJSON());
  });
});
