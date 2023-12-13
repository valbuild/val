import * as marked from "marked";
import {
  OrderedListNode,
  AnyRichTextOptions,
  UnorderedListNode,
  LinkSource,
  RichTextNode,
  SpanNode,
  LinkNode,
  ListItemNode,
  RichTextOptions,
  RichTextSource,
  RichText,
  VAL_EXTENSION,
  ParagraphNode,
  HeadingNode,
  Internal,
  ImageSource,
} from "@valbuild/core";

const VAL_START_TAG_PREFIX = '<val value="';
const VAL_START_TAG_SUFFIX = '">';
const VAL_END_TAG = "</val>";

type AnyListChildren =
  | OrderedListNode<AnyRichTextOptions>["children"]
  | UnorderedListNode<AnyRichTextOptions>["children"];

function parseTokens(
  tokens: marked.Token[],
  sourceNodes: (ImageSource | LinkSource)[],
  cursor: number,
  insideList = false
): { children: RichTextNode<AnyRichTextOptions>[]; cursor: number } {
  const children: RichTextNode<AnyRichTextOptions>[] = [];
  while (cursor < tokens.length) {
    const token = tokens[cursor];
    if (token.type === "heading") {
      children.push({
        tag: `h${token.depth as 1 | 2 | 3 | 4 | 5 | 6}`,
        children: parseTokens(token.tokens ? token.tokens : [], sourceNodes, 0)
          .children as HeadingNode<AnyRichTextOptions>["children"],
      });
    } else if (token.type === "paragraph") {
      children.push({
        tag: "p",
        children: parseTokens(token.tokens ? token.tokens : [], sourceNodes, 0)
          .children as ParagraphNode<AnyRichTextOptions>["children"],
      });
    } else if (token.type === "strong") {
      children.push({
        tag: "span",
        classes: ["bold"],
        children: parseTokens(token.tokens ? token.tokens : [], sourceNodes, 0)
          .children as SpanNode<AnyRichTextOptions>["children"],
      });
    } else if (token.type === "em") {
      children.push({
        tag: "span",
        classes: ["italic"],
        children: parseTokens(token.tokens ? token.tokens : [], sourceNodes, 0)
          .children as SpanNode<AnyRichTextOptions>["children"],
      });
    } else if (token.type === "del") {
      children.push({
        tag: "span",
        classes: ["line-through"],
        children: parseTokens(token.tokens ? token.tokens : [], sourceNodes, 0)
          .children as SpanNode<AnyRichTextOptions>["children"],
      });
    } else if (token.type === "text") {
      if ("tokens" in token && Array.isArray(token.tokens)) {
        children.push(
          ...parseTokens(token.tokens, sourceNodes, cursor, insideList).children
        );
      } else {
        if (insideList && typeof token.raw === "string") {
          const lines = token.raw.split("\n");
          const tags: RichTextNode<AnyRichTextOptions>[] = lines.flatMap(
            (line, i) => {
              if (i === lines.length - 1) return [line];
              return [line, { tag: "br", children: [] }];
            }
          );
          children.push(...tags);
        } else {
          children.push(token.raw);
        }
      }
    } else if (token.type === "list") {
      children.push({
        tag: token.ordered ? "ol" : "ul",
        children: parseTokens(token.items, sourceNodes, 0)
          .children as AnyListChildren,
      });
    } else if (token.type === "list_item") {
      children.push({
        tag: "li",
        children: parseTokens(
          token.tokens ? token.tokens : [],
          sourceNodes,
          0,
          true
        ).children as ListItemNode<AnyRichTextOptions>["children"],
      });
    } else if (token.type === "space") {
      // do nothing
    } else if (token.type === "html") {
      if (token.text === VAL_END_TAG) {
        return { children, cursor };
      }
      const suffixIndex = token.text.indexOf(VAL_START_TAG_SUFFIX);
      if (token.text.startsWith(VAL_START_TAG_PREFIX) && suffixIndex > -1) {
        const number = Number(
          token.text.slice(VAL_START_TAG_PREFIX.length, suffixIndex)
        );
        if (Number.isNaN(number)) {
          throw Error(
            `Illegal val intermediate node: ${JSON.stringify(token)}`
          );
        }
        const { children: subChildren, cursor: subCursor } = parseTokens(
          tokens.map((token) => {
            if (token.type === "link" || token.type === "list") {
              return {
                type: "text",
                raw: token.raw,
                text: token.raw,
              };
            }
            return token;
          }),
          sourceNodes,
          cursor + 1
        );
        const sourceNode = sourceNodes[number];
        if (sourceNode._type === "link") {
          children.push({
            tag: "a",
            href: sourceNode.href,
            children: subChildren as LinkNode<AnyRichTextOptions>["children"],
          });
        } else if (sourceNode._type === "file") {
          children.push({
            tag: "img",
            src: Internal.convertFileSource(sourceNode).url,
            width: sourceNode.metadata?.width,
            height: sourceNode.metadata?.height,
            children: [],
          });
        }

        cursor = subCursor;
      }
      const br_html_regex = /<br\s*\/?>/gi; // matches <br>, <br/>, <br />; case insensitive
      if (token.text.trim().match(br_html_regex)) {
        children.push({
          tag: "br",
          children: [],
        });
      }
    } else if (token.type === "link") {
      if (token.raw === token.href) {
        // avoid auto-linking (provided by github flavoured markdown, but we want strikethrough so keep it enabled)
        children.push(token.raw);
      } else {
        children.push({
          tag: "a",
          href: token.href,
          children: parseTokens(
            token.tokens ? token.tokens : [],
            sourceNodes,
            0
          ).children as LinkNode<AnyRichTextOptions>["children"],
        });
      }
    } else if (token.type === "br") {
      children.push({
        tag: "br",
        children: [],
      });
    } else {
      console.error(
        `Could not parse markdown: unsupported token type: ${token.type}. Found: ${token.raw}`
      );
    }
    cursor++;
  }
  return { children, cursor };
}

export function parseRichTextSource<O extends RichTextOptions>({
  templateStrings,
  exprs: nodes,
}: RichTextSource<O>): RichText<O> {
  // TODO: validate that templateStrings does not contain VAL_NODE_PREFIX
  const inputText = templateStrings
    .flatMap((templateString, i) => {
      const node = nodes[i];
      if (node) {
        if (node[VAL_EXTENSION] === "link") {
          return templateString.concat(
            `${VAL_START_TAG_PREFIX}${i}${VAL_START_TAG_SUFFIX}${node.children[0]}${VAL_END_TAG}`
          );
        } else {
          return templateString.concat(
            `${VAL_START_TAG_PREFIX}${i}${VAL_START_TAG_SUFFIX}${VAL_END_TAG}`
          );
        }
      }
      return templateString;
    })
    .join("");
  const tokenList = marked.lexer(inputText, {
    gfm: true,
  });
  const { children, cursor } = parseTokens(tokenList, nodes, 0);
  if (cursor !== tokenList.length) {
    throw Error(
      "Unexpectedly terminated markdown parsing. Possible reason: unclosed html tag?"
    );
  }
  return {
    [VAL_EXTENSION]: "richtext",
    children,
  } as RichText<O>;
}
