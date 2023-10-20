import * as marked from "marked";
import { FileSource, FILE_REF_PROP } from "./file";
import { VAL_EXTENSION } from ".";
import { convertFileSource } from "../schema/image";
import { LinkSource } from "./link";

export type RichTextOptions = {
  headings?: ("h1" | "h2" | "h3" | "h4" | "h5" | "h6")[];
  img?: boolean;
  a?: boolean;
  ul?: boolean;
  ol?: boolean;
  lineThrough?: boolean;
  bold?: boolean;
  italic?: boolean;
};
export type AnyRichTextOptions = {
  headings: ("h1" | "h2" | "h3" | "h4" | "h5" | "h6")[];
  img: true;
  a: true;
  ul: true;
  ol: true;
  lineThrough: true;
  bold: true;
  italic: true;
};

// Classes
export type LineThrough<O extends RichTextOptions> =
  O["lineThrough"] extends true ? "line-through" : never;

export type Italic<O extends RichTextOptions> = O["italic"] extends true
  ? "italic"
  : never;

export type Bold<O extends RichTextOptions> = O["bold"] extends true
  ? "bold"
  : never;

export type Classes<O extends RichTextOptions> =
  | LineThrough<O>
  | Italic<O>
  | Bold<O>;

/// Paragraph
export type ParagraphNode<O extends RichTextOptions> = {
  tag: "p";
  children: (string | SpanNode<O> | LinkNode<O> | ImageNode<O>)[];
};

/// Break
export type BrNode = {
  tag: "br";
  children: [];
};

/// Span
export type SpanNode<O extends RichTextOptions> = {
  tag: "span";
  classes: Classes<O>[];
  children: [string | SpanNode<O>];
};

/// Image
type ImageTagNode = {
  tag: "img";
  src: string;
  height?: number;
  width?: number;
  children: [];
};
type ImageSource = FileSource<{
  width: number;
  height: number;
  sha256: string;
}>;
export type ImageNode<O extends RichTextOptions> = O["img"] extends true
  ? ImageTagNode
  : never;

/// Link
type LinkTagNode<O extends RichTextOptions> = {
  tag: "a";
  href: string;
  children: (string | SpanNode<O>)[];
};
export type LinkNode<O extends RichTextOptions> = O["a"] extends true
  ? LinkTagNode<O>
  : never;

/// List
export type ListItemNode<O extends RichTextOptions> = {
  tag: "li";
  children: (
    | string
    | SpanNode<O>
    | LinkNode<O>
    | UnorderedListNode<O>
    | OrderedListNode<O>
  )[];
};

export type UnorderedListNode<O extends RichTextOptions> = O["ul"] extends true
  ? {
      tag: "ul";
      dir?: "ltr" | "rtl";
      children: ListItemNode<O>[];
    }
  : never;

export type OrderedListNode<O extends RichTextOptions> = O["ol"] extends true
  ? {
      tag: "ol";
      dir?: "ltr" | "rtl";
      children: ListItemNode<O>[];
    }
  : never;

/// Heading
export type HeadingNode<O extends RichTextOptions> = O["headings"] extends (
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
)[]
  ? {
      tag: O["headings"][number];
      children: (string | SpanNode<O>)[];
    }
  : never;

/// Root and nodes
export type RichTextNode<O extends RichTextOptions> =
  | string
  | RootNode<O>
  | ListItemNode<O>
  | SpanNode<O>
  | LinkNode<O>
  | ImageNode<O>;

export type RootNode<O extends RichTextOptions> =
  | HeadingNode<O>
  | ParagraphNode<O>
  | BrNode
  | UnorderedListNode<O>
  | OrderedListNode<O>;

/// Main types

/**
 * RichTextSource is defined in ValModules
 **/
export type RichTextSource<O extends RichTextOptions> = {
  [VAL_EXTENSION]: "richtext";
  templateStrings: string[];
  nodes: (
    | (O["img"] extends true ? ImageSource : never)
    | (O["a"] extends true ? LinkSource : never)
  )[];
};
/**
 * RichText is accessible by users (after conversion via useVal / fetchVal)
 * Internally it is a Selector
 **/
export type RichText<O extends RichTextOptions> = {
  [VAL_EXTENSION]: "richtext";
  children: RootNode<O>[];
};

const VAL_START_TAG_PREFIX = '<val value="';
const VAL_START_TAG_SUFFIX = '">';
const VAL_END_TAG = "</val>";

type AnyListChildren =
  | OrderedListNode<AnyRichTextOptions>["children"]
  | UnorderedListNode<AnyRichTextOptions>["children"];

function parseTokens(
  tokens: marked.Token[],
  sourceNodes: (ImageSource | LinkSource)[],
  cursor: number
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
          ...parseTokens(token.tokens, sourceNodes, cursor).children
        );
      } else {
        children.push(token.text);
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
        children: parseTokens(token.tokens ? token.tokens : [], sourceNodes, 0)
          .children as ListItemNode<AnyRichTextOptions>["children"],
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
          tokens,
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
            src: convertFileSource(sourceNode).url,
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
    } else {
      console.error(
        `Could not parse markdown: unsupported token type: ${token.type}. Found: ${token.raw}`
      );
    }
    cursor++;
  }
  return { children, cursor };
}

export function richtext<
  O extends RichTextOptions,
  Nodes extends never | ImageSource | LinkSource
>(templateStrings: TemplateStringsArray, ...nodes: Nodes[]): RichTextSource<O> {
  return {
    [VAL_EXTENSION]: "richtext",
    templateStrings: templateStrings as unknown as string[],
    nodes:
      nodes as RichTextSource<AnyRichTextOptions>["nodes"] as RichTextSource<O>["nodes"],
  };
}

export function parseRichTextSource<O extends RichTextOptions>({
  templateStrings,
  nodes,
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
