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

export function parseRichTextSource<O extends RichTextOptions>({
  templateStrings,
  exprs,
}: RichTextSource<O>): RichText<O> {
  const children: RichTextNode<AnyRichTextOptions>[] = [];
  for (
    let templateStringIdx = 0;
    templateStringIdx < templateStrings.length;
    templateStringIdx++
  ) {
    const { tokens } = lexer(templateStrings[templateStringIdx]);
    const expr = exprs[templateStringIdx];

    let i = 0;
    const rootChildren: RootNode<AnyRichTextOptions>[] = [];
    while (i < tokens.length) {
      if (
        isType("#", i, tokens) &&
        isType("space", i + 1, tokens) &&
        isType("text", i + 2, tokens)
      ) {
        const headingLevel = tokens[i]?.amount;
        if (headingLevel && headingLevel > 0 && headingLevel < 6) {
          const headingText = tokens[i + 2]?.raw || "";
          rootChildren.push({
            tag: `h${headingLevel as 1 | 2 | 3 | 4 | 5 | 6}`,
            children: [headingText],
          });
          i += 3;
          if (isType("space", i, tokens)) {
            i += 1;
          }
          if (isType("#", i, tokens)) {
            // ignore
            i += 1;
          }
          if (isType("space", i, tokens)) {
            i += 1;
          }

          continue;
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

  return {
    [VAL_EXTENSION]: "richtext",
    children,
  } as RichText<O>;
}

function isHeading(i: number, tokens: Token[]) {
  if (
    isType("#", i, tokens) &&
    isType("space", i + 1, tokens) &&
    isType("text", i + 2, tokens)
  ) {
    const headingLevel = tokens[i]?.amount;
    if (headingLevel && headingLevel < 6) {
      return true;
    }
  }
  return -1;
}

function isType(type: Token["type"], i: number, tokens: Token[]): boolean {
  return tokens[i]?.type === type;
}
