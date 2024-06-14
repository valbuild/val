import * as marked from "marked";
import {
  OrderedListNode,
  AllRichTextOptions,
  UnorderedListNode,
  LinkSource,
  RichTextNode,
  SpanNode,
  LinkNode,
  ListItemNode,
  RichTextOptions,
  VAL_EXTENSION,
  ParagraphNode,
  HeadingNode,
  ImageSource,
  Styles,
  RichTextSource,
  FILE_REF_SUBTYPE_TAG,
} from "@valbuild/core";

const VAL_START_TAG_PREFIX = '<val value="';
const VAL_START_TAG_SUFFIX = '">';
const VAL_END_TAG = "</val>";

type AnyListChildren =
  | OrderedListNode<AllRichTextOptions>["children"]
  | UnorderedListNode<AllRichTextOptions>["children"];

function parseTokens(
  tokens: marked.Token[],
  sourceNodes: (ImageSource | LinkSource)[],
  cursor: number,
  insideList = false
): { children: RichTextNode<AllRichTextOptions>[]; cursor: number } {
  const children: RichTextNode<AllRichTextOptions>[] = [];

  function merge(
    token:
      | marked.Tokens.Strong
      | marked.Tokens.Del
      | marked.Tokens.Em
      | marked.Tokens.Generic,
    clazz: Styles<AllRichTextOptions>
  ) {
    const parsedTokens = parseTokens(
      token.tokens ? token.tokens : [],
      sourceNodes,
      0
    ) as { children: [SpanNode<AllRichTextOptions>] } | { children: string[] };
    children.push({
      tag: "span",
      styles: [clazz].concat(
        parsedTokens.children.flatMap((child) =>
          typeof child === "string" ? [] : child.styles
        )
      ),
      children: parsedTokens.children.flatMap((child) =>
        typeof child === "string" ? child : child.children
      ) as [string],
    });
  }
  while (cursor < tokens.length) {
    const token = tokens[cursor];
    if (token.type === "heading") {
      children.push({
        tag: `h${token.depth as 1 | 2 | 3 | 4 | 5 | 6}`,
        children: parseTokens(token.tokens ? token.tokens : [], sourceNodes, 0)
          .children as HeadingNode<AllRichTextOptions>["children"],
      });
    } else if (token.type === "paragraph") {
      children.push({
        tag: "p",
        children: parseTokens(token.tokens ? token.tokens : [], sourceNodes, 0)
          .children as ParagraphNode<AllRichTextOptions>["children"],
      });
    } else if (token.type === "strong") {
      merge(token, "bold");
    } else if (token.type === "em") {
      merge(token, "italic");
    } else if (token.type === "del") {
      merge(token, "line-through");
    } else if (token.type === "text") {
      if ("tokens" in token && Array.isArray(token.tokens)) {
        children.push(
          ...parseTokens(token.tokens, sourceNodes, cursor, insideList).children
        );
      } else {
        if (insideList && typeof token.raw === "string") {
          const lines = token.raw.split("\n");
          const tags: RichTextNode<AllRichTextOptions>[] = lines.flatMap(
            (line, i) => {
              if (i === lines.length - 1) return [line];
              if (i === lines.length - 1 && line === "") return [];
              if (line === "") return { tag: "br" };
              return [line, { tag: "br" }];
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
        ).children as ListItemNode<AllRichTextOptions>["children"],
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
            children: subChildren as LinkNode<AllRichTextOptions>["children"],
          });
        } else if (sourceNode._type === "file") {
          // @ts-expect-error We are transitioning from markdown to structured objects, with structured objects we no longer want c.rt.image
          delete sourceNode[FILE_REF_SUBTYPE_TAG];
          children.push({
            tag: "img",
            src: sourceNode,
          });
        }

        cursor = subCursor;
      }
      const br_html_regex = /<br\s*\/?>/gi; // matches <br>, <br/>, <br />; case insensitive
      if (token.text.trim().match(br_html_regex)) {
        children.push({
          tag: "br",
        });
        if (tokens[cursor + 1]?.raw.trim() === "") {
          // if next token is a new line or white-spaces, skip it
          // this typically means we have a <br> AND a new line, which, semantically, is just a <br>
          cursor++;
        }
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
          ).children as LinkNode<AllRichTextOptions>["children"],
        });
      }
    } else if (token.type === "br") {
      children.push({
        tag: "br",
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
}: {
  templateStrings: string[];
  exprs: (
    | (NonNullable<O["inline"]>["img"] extends true ? ImageSource : never)
    | (NonNullable<O["inline"]>["a"] extends true ? LinkSource : never)
  )[];
}): RichTextSource<O> {
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (children as any).markdownish = true; // Markdown is an intermediate format - we are planning on replacing it with a structured object format
  return children as RichTextSource<O>;
}
