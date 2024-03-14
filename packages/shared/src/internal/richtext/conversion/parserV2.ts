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

// TODO: Entity and numeric character references

/**
 * Parse a RichTextSource into a RichText
 *
 * @description
 * We had this: https://spec.commonmark.org/0.31.2/ in mind while implementing this parser.
 * NOTE: It does not support all features of CommonMark, since they do not make sense in the context of Val.
 *
 * Notably, it does not support:
 *  - links
 *  - images
 *  - block quotes
 *  - code blocks using indents or code fences using backticks / tildes (```this is a code fence with backticks```) and spans (`this is a code span`)
 *  - raw html (except for <br />)
 *  - different ways of hard breaking except for <br />. E.g. two spaces or backslash at the end of a line. Reason: they are not commonly used and complicates parsing.
 * Or any other non-standard markdown features.
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

    // remove trailing spaces and newlines
    let end = tokens.length;
    while (end > 0) {
      if (tokens[end - 1]?.type === "space" || tokens[end - 1]?.type === "\n") {
        end -= 1;
      } else {
        break;
      }
    }
    while (i < end) {
      if (!openBlock) {
        // starts a new block:
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
        } else if (isType("space", i, tokens) || isType("\n", i, tokens)) {
          i++;
        } else if (isType("-", i, tokens) && isType("space", i + 1, tokens)) {
          openBlock = {
            tag: "ul",
            children: [],
          };
          i += 2;
        } else if (
          isType("(1-9).", i, tokens) &&
          isType("space", i + 1, tokens)
        ) {
          openBlock = {
            tag: "ol",
            children: [],
          };
          i += 2;
        } else {
          console.log("closeblock fallback", JSON.stringify(tokens[i].type));
          openBlock = {
            tag: "p",
            children: [tokens[i]?.raw || ""],
          };
          i++;
        }
      } else if (
        isType("\n", i, tokens) &&
        (openBlock.tag === "h1" ||
          openBlock.tag === "h2" ||
          openBlock.tag === "h3" ||
          openBlock.tag === "h4" ||
          openBlock.tag === "h5" ||
          openBlock.tag === "h6")
      ) {
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
            if (openBlock.tag === "ol" || openBlock.tag === "ul") {
              if (!openBlock.children[0]) {
                openBlock.children.push({
                  tag: "li",
                  children: [text],
                });
              } else {
                const lastLi =
                  openBlock.children[openBlock.children.length - 1].children[
                    openBlock.children[openBlock.children.length - 1].children
                      .length - 1
                  ];
                if (typeof lastLi === "string") {
                  openBlock.children[openBlock.children.length - 1].children[
                    openBlock.children[openBlock.children.length - 1].children
                      .length - 1
                  ] = lastLi + text;
                } else {
                  openBlock.children[
                    openBlock.children.length - 1
                  ].children.push(text);
                }
              }
            } else {
              openBlock.children.push(text);
            }
          }
        } else if (
          openBlock.tag === "ol" ||
          (openBlock.tag === "ul" && isListToken(i, tokens))
        ) {
          openBlock.children.push({
            tag: "li",
            children: [],
          });
          i += 1;
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

function isListToken(i: number, tokens: Token[]): boolean {
  return tokens[i]?.type === "-" || tokens[i]?.type === "(1-9).";
}

function isListBlock(block: RichTextNode<AnyRichTextOptions>) {
  if (typeof block === "string") {
    return false;
  }
  return block.tag === "ul" || block.tag === "ol";
}

function isType(type: Token["type"], i: number, tokens: Token[]): boolean {
  return tokens[i]?.type === type;
}
