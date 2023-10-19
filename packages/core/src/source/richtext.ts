import * as marked from "marked";
import { FileSource } from "./file";
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

// Nodes
type NodeType =
  | "source" // internal format
  | "node"; // user facing richtext;

/// Paragraph
export type ParagraphNode<O extends RichTextOptions, Type extends NodeType> = {
  tag: "p";
  children: (
    | string
    | SpanNode<O, Type>
    | LinkNode<O, Type>
    | ImageNode<O, Type>
  )[];
};

/// Break
export type BrNode = {
  tag: "br";
  children: [];
};

/// Span
export type SpanNode<O extends RichTextOptions, Type extends NodeType> = {
  tag: "span";
  classes: Classes<O>[];
  children: [string | SpanNode<O, Type>];
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
export type ImageNode<
  O extends RichTextOptions,
  Type extends NodeType
> = O["img"] extends true
  ? Type extends "source"
    ? ImageSource
    : Type extends "node"
    ? ImageTagNode
    : never
  : never;

/// Link
type LinkTagNode<O extends RichTextOptions, Type extends NodeType> = {
  tag: "a";
  href: string;
  children: (string | SpanNode<O, Type>)[];
};
export type LinkNode<
  O extends RichTextOptions,
  Type extends NodeType
> = O["a"] extends true
  ? Type extends "source"
    ? LinkSource
    : Type extends "node"
    ? LinkTagNode<O, Type>
    : never
  : never;

/// List
export type ListItemNode<O extends RichTextOptions, Type extends NodeType> = {
  tag: "li";
  children: (
    | string
    | SpanNode<O, Type>
    | LinkNode<O, Type>
    | UnorderedListNode<O, Type>
    | OrderedListNode<O, Type>
  )[];
};

export type UnorderedListNode<
  O extends RichTextOptions,
  Type extends NodeType
> = O["ul"] extends true
  ? {
      tag: "ul";
      dir?: "ltr" | "rtl";
      children: ListItemNode<O, Type>[];
    }
  : never;

export type OrderedListNode<
  O extends RichTextOptions,
  Type extends NodeType
> = O["ol"] extends true
  ? {
      tag: "ol";
      dir?: "ltr" | "rtl";
      children: ListItemNode<O, Type>[];
    }
  : never;

/// Heading
export type HeadingNode<
  O extends RichTextOptions,
  Type extends NodeType
> = O["headings"] extends ("h1" | "h2" | "h3" | "h4" | "h5" | "h6")[]
  ? {
      tag: O["headings"][number];
      children: (string | SpanNode<O, Type>)[];
    }
  : never;

/// Root and nodes
export type RichTextNode<
  O extends RichTextOptions,
  Type extends NodeType = "node"
> =
  | string
  | RootNode<O, Type>
  | ListItemNode<O, Type>
  | SpanNode<O, Type>
  | LinkNode<O, Type>
  | ImageNode<O, Type>;

export type RootNode<O extends RichTextOptions, Type extends NodeType> =
  | HeadingNode<O, Type>
  | ParagraphNode<O, Type>
  | BrNode
  | UnorderedListNode<O, Type>
  | OrderedListNode<O, Type>;

/// Main types

/**
 * RichTextSource is defined in ValModules
 **/
export type RichTextSource<O extends RichTextOptions> = {
  [VAL_EXTENSION]: "richtext";
  children: RootNode<O, "source">[];
};

type AnyList =
  | UnorderedListNode<AnyRichTextOptions, "source">["children"]
  | OrderedListNode<AnyRichTextOptions, "source">["children"];

/**
 * RichText is accessible by users (after conversion via useVal / fetchVal)
 * Internally it is a Selector
 **/
export type RichText<O extends RichTextOptions> = {
  [VAL_EXTENSION]: "richtext";
  children: RootNode<O, "node">[];
};

const VAL_START_TAG_PREFIX = '<val value="';
const VAL_START_TAG_SUFFIX = '">';
const VAL_END_TAG = "</val>";

function parseTokens(
  tokens: marked.Token[],
  sourceNodes: (ImageSource | LinkSource)[]
): RichTextNode<AnyRichTextOptions, "source">[] {
  const children: RichTextNode<AnyRichTextOptions, "source">[] = [];

  for (const token of tokens) {
    if (token.type === "heading") {
      children.push({
        tag: `h${token.depth as 1 | 2 | 3 | 4 | 5 | 6}`,
        children: parseTokens(
          token.tokens ? token.tokens : [],
          sourceNodes
        ) as HeadingNode<AnyRichTextOptions, "source">["children"],
      });
    } else if (token.type === "paragraph") {
      children.push({
        tag: "p",
        children: parseTokens(
          token.tokens ? token.tokens : [],
          sourceNodes
        ) as ParagraphNode<AnyRichTextOptions, "source">["children"],
      });
    } else if (token.type === "strong") {
      children.push({
        tag: "span",
        classes: ["bold"],
        children: parseTokens(
          token.tokens ? token.tokens : [],
          sourceNodes
        ) as SpanNode<AnyRichTextOptions, "source">["children"],
      });
    } else if (token.type === "em") {
      children.push({
        tag: "span",
        classes: ["italic"],
        children: parseTokens(
          token.tokens ? token.tokens : [],
          sourceNodes
        ) as SpanNode<AnyRichTextOptions, "source">["children"],
      });
    } else if (token.type === "del") {
      children.push({
        tag: "span",
        classes: ["line-through"],
        children: parseTokens(
          token.tokens ? token.tokens : [],
          sourceNodes
        ) as SpanNode<AnyRichTextOptions, "source">["children"],
      });
    } else if (token.type === "text") {
      if ("tokens" in token && Array.isArray(token.tokens)) {
        children.push(...parseTokens(token.tokens, sourceNodes));
      }
      children.push(token.text);
    } else if (token.type === "list") {
      children.push({
        tag: token.ordered ? "ol" : "ul",
        children: parseTokens(token.items, sourceNodes) as AnyList,
      });
    } else if (token.type === "list_item") {
      children.push({
        tag: "li",
        children: parseTokens(
          token.tokens ? token.tokens : [],
          sourceNodes
        ) as ListItemNode<AnyRichTextOptions, "source">["children"],
      });
    } else if (token.type === "space") {
      // do nothing
    } else if (token.type === "html") {
      if (token.text === VAL_END_TAG) {
        // TODO
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
        if (token.block) {
          children.push({
            tag: "p",
            children: [sourceNodes[number]] as ParagraphNode<
              AnyRichTextOptions,
              "source"
            >["children"],
          });
        } else {
          children.push({ ...sourceNodes[number] });
        }
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
  }
  return children;
}

function imgSrcToImgTag(
  imageSrc: ImageNode<AnyRichTextOptions, "source">
): ImageNode<AnyRichTextOptions, "node"> {
  const converted = convertFileSource(imageSrc);
  return {
    tag: "img",
    src: converted.url,
    width: imageSrc.metadata?.width,
    height: imageSrc.metadata?.height,
  } as ImageNode<O, "node">;
}

function linkSrcToLinkTag(
  linkSrc: LinkNode<AnyRichTextOptions, "source">
): LinkNode<AnyRichTextOptions, "node"> {
  if (childNodes.length === 1) {
    const childNode = childNodes[0];
    if (typeof childNode !== "string" && childNode.tag === "p") {
      const linkTag = {
        tag: "a" as const,
        href: linkSrc.href,
        children: childNode.children,
      } as LinkNode<O, "node">;

      // TODO: create intermediate type of RichTextSourceNode that includes isBlock and remove the 'isBlock' in predicate
      if ("isBlock" in linkSrc && linkSrc.isBlock) {
        return {
          tag: "p",
          children: [linkTag],
        };
      }
      return linkTag;
    }
  }
  throw Error(`Unexpected tokens in link: ${JSON.stringify(childNodes)}`);
}

function sourceToNode(
  source: RichTextNode<AnyRichTextOptions, "source">
): RichTextNode<AnyRichTextOptions> {
  if (typeof source === "object" && VAL_EXTENSION in source) {
    if (source[VAL_EXTENSION] === "file") {
      return imgSrcToImgTag(source);
    } else if (source[VAL_EXTENSION] === "link") {
      return linkSrcToLinkTag(source);
    } else {
      const exhaustiveCheck: never = source[VAL_EXTENSION];
      throw new Error(
        "Unexpected source node: " + JSON.stringify(source, exhaustiveCheck, 2)
      );
    }
  } else if (typeof source === "object" && "tag" in source) {
    if ("children" in source) {
      return {
        ...source,
        children: source.children.map((child) => sourceToNode(child)),
      } as RichTextNode<AnyRichTextOptions>;
    }
  }
  return source;
}

export function convertRichTextSource<O extends RichTextOptions>(
  src: RichTextSource<O>
): RichText<O> {
  return {
    [VAL_EXTENSION]: "richtext",
    children: src.children.map((child) => sourceToNode(child)),
  } as RichText<O>;
}

export function richtext<
  O extends RichTextOptions,
  Nodes extends never | ImageSource | LinkSource
>(
  templateStrings: TemplateStringsArray,
  ...sourceNodes: Nodes[]
): RichTextSource<O> {
  return internalRichText(templateStrings, ...sourceNodes);
}

export function internalRichText<
  O extends RichTextOptions,
  Nodes extends never | ImageSource | LinkSource
>(
  templateStrings: readonly string[],
  ...sourceNodes: Nodes[]
): RichTextSource<O> {
  // TODO: validate that templateStrings does not contain VAL_NODE_PREFIX
  const inputText = templateStrings
    .flatMap((templateString, i) => {
      if (sourceNodes[i]) {
        return templateString.concat(
          `${VAL_START_TAG_PREFIX}${i}${VAL_START_TAG_SUFFIX}`
        );
      }
      return templateString;
    })
    .join("");
  const lex = marked.lexer(inputText, {
    gfm: true,
  });
  return {
    [VAL_EXTENSION]: "richtext",
    children: parseTokens(lex, sourceNodes),
  } as RichTextSource<O>;
}
