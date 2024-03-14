import {
  AnyRichTextOptions,
  RichText,
  RichTextNode,
  RichTextOptions,
  RichTextSource,
  RootNode,
  VAL_EXTENSION,
} from "@valbuild/core";
import { Token, lexer } from "./lexer";

/**
 * Parse a RichTextSource into a RichText
 *
 * @description
 * We read this: https://spec.commonmark.org/0.31.2/
 * while implementing this parser
 *
 * It does not support all features of CommonMark.
 *
 * Notably, it does not support:
 *  - block quotes
 *  - code blocks
 */
export function parseRichTextSource<O extends RichTextOptions>({
  templateStrings,
  exprs,
}: RichTextSource<O>): RichText<O> {
  const rootChildren: RootNode<AnyRichTextOptions>[] = [];
  let openBlock: RichTextNode<AnyRichTextOptions> | undefined = undefined;

  for (
    let templateStringIdx = 0;
    templateStringIdx < templateStrings.length;
    templateStringIdx++
  ) {
    const { tokens } = lexer(templateStrings[templateStringIdx]);
    // const expr = exprs[templateStringIdx];

    console.log(tokens);

    let i = 0;
    while (i < tokens.length) {
      if (!openBlock) {
        if (
          isType("#", i, tokens) &&
          isType("space", i + 1, tokens) &&
          isType("text", i + 2, tokens)
        ) {
          const headingLevel = tokens[i]?.amount;
          i += 2;
          if (headingLevel && headingLevel > 0 && headingLevel <= 6) {
            openBlock = {
              tag: `h${headingLevel as 1 | 2 | 3 | 4 | 5 | 6}`,
              children: [],
            };
          }
        } else if (isType("text", i, tokens)) {
          openBlock = {
            tag: "p",
            children: [tokens[i]?.raw || ""],
          };
          i += 1;
        } else {
          console.log("closeblock", JSON.stringify(tokens[i].type));
          i++;
        }
      } else if (isType("\n", i, tokens) && openBlock.tag.startsWith("h")) {
        rootChildren.push(openBlock);
        i += 1;
        openBlock = undefined;
      } else if (openBlock.tag === "p" && isType("\n", i, tokens)) {
        if (
          tokens[i]?.amount === 1 &&
          !(isType("space", i + 1, tokens) && isType("\n", i + 2, tokens))
        ) {
          i += 1;
        } else {
          rootChildren.push(openBlock);
          openBlock = undefined;
          i += 1;
        }
      } else {
        const lastChild = openBlock.children[openBlock.children.length - 1];
        if (isType("text", i, tokens) || isType("space", i, tokens)) {
          const text = tokens[i]?.raw || " ";
          i += 1;
          if (typeof lastChild === "string") {
            openBlock.children[openBlock.children.length - 1] =
              lastChild + text;
          } else {
            openBlock.children.push(text);
          }
        } else {
          console.log(
            "openblock",
            openBlock.tag,
            JSON.stringify(tokens[i].type)
          );
          i++;
        }
      }
    }

    if (templateStringIdx < exprs.length) {
      // const sourceNode = exprs[i];
      // if (sourceNode._type === "link") {
      //   children.push({
      //     tag: "a",
      //     href: sourceNode.href,
      //     children: sourceNode.children,
      //   });
      // } else if (sourceNode._type === "file") {
      //   children.push({
      //     tag: "img",
      //     src: Internal.convertFileSource(sourceNode).url,
      //     width: sourceNode.metadata?.width,
      //     height: sourceNode.metadata?.height,
      //     mimeType: sourceNode.metadata?.mimeType,
      //   });
      // }
    }
  }

  if (openBlock) {
    rootChildren.push(openBlock);
  }

  return {
    [VAL_EXTENSION]: "richtext",
    children: rootChildren,
  } as RichText<O>;
}

function isType(type: Token["type"], i: number, tokens: Token[]): boolean {
  return tokens[i]?.type === type;
}
