import * as marked from "marked";
import { FileSource } from "../source/file";

type Options = {
  headings?: ("h1" | "h2" | "h3" | "h4" | "h5" | "h6")[];
  // link?: boolean;
  image?: boolean;
  bulletList?: boolean; // TODO: naming
  numberList?: boolean; // TODO: naming
  underline?: boolean;
  lineThrough?: boolean;
  bold?: boolean;
  italic?: boolean;
  fontFamily?: Record<string, string[]>;
  fontSize?: Record<string, string[]>;
  blockQuote?: boolean; // TODO: naming
};

type ParagraphNode<O extends Options> = {
  tag: "p";
  children: (string | SpanNode<O> | AnchorNode<O> | ImageNode<O>)[];
};

type Underline<O extends Options> = O["underline"] extends true
  ? "underline"
  : never;
type LineThrough<O extends Options> = O["lineThrough"] extends true
  ? "line-through"
  : never;
type Italic<O extends Options> = O["italic"] extends true ? "italic" : never;
type Bold<O extends Options> = O["bold"] extends true ? "font-bold" : never;
type FontFamily<O extends Options> = O["fontFamily"] extends Record<
  string,
  unknown
>
  ? `font-${keyof O["fontFamily"] & string}`
  : never;
type FontSize<O extends Options> = O["fontSize"] extends Record<string, unknown>
  ? `text-${keyof O["fontSize"] & string}`
  : never;

type Classes<O extends Options> =
  | Underline<O>
  | LineThrough<O>
  | Italic<O>
  | Bold<O>
  | FontFamily<O>
  | FontSize<O>;

type SpanNode<O extends Options> = {
  tag: "span";
  class: Classes<O>[];
  children: [string | SpanNode<O>];
};

type AnchorNode<O extends Options> = O["link"] extends true
  ? {
      tag: "a";
      href: string;
      children: [string];
    }
  : never;

type ImageNode<O extends Options> = O["image"] extends true
  ? {
      tag: "img";
      src: string;
    }
  : never;

type ListItemNode<O extends Options> = {
  tag: "li";
  children: (
    | string
    | SpanNode<O>
    | AnchorNode<O>
    | ImageNode<O>
    | UnorderedListNode<O>
    | OrderedListNode<O>
  )[];
};

type UnorderedListNode<O extends Options> = O["bulletList"] extends true
  ? {
      tag: "ul";
      dir?: "ltr" | "rtl";
      children: ListItemNode<O>[];
    }
  : never;

type OrderedListNode<O extends Options> = O["numberList"] extends true
  ? {
      tag: "ol";
      dir?: "ltr" | "rtl";
      children: ListItemNode<O>[];
    }
  : never;

type HeadingNode<O extends Options> = O["headings"] extends any[]
  ? {
      tag: O["headings"][number];
      children: (string | SpanNode<O> | AnchorNode<O>)[];
    }
  : never;

type BlockQuote<O extends Options> = O["blockQuote"] extends true
  ? { tag: "blockquote"; children: [string] }
  : never;

type RichTextSource<O extends Options> = (
  | HeadingNode<O>
  | ParagraphNode<O>
  | UnorderedListNode<O>
  | OrderedListNode<O>
  | BlockQuote<O>
  | (O["image"] extends true
      ? FileSource<{
          // image
          width: number;
          height: number;
          sha256: string;
        }>
      : never)
)[];

function parseTokens<O extends Options>(
  tokens: marked.Token[]
): RichTextSource<O> {
  return tokens.flatMap((token) => {
    if (token.type === "heading") {
      return [
        {
          tag: `h${token.depth}`,
          children: parseTokens(token.tokens ? token.tokens : []),
        },
      ];
    }
    if (token.type === "paragraph") {
      return [
        {
          tag: "p",
          children: parseTokens(token.tokens ? token.tokens : []),
        },
      ];
    }
    if (token.type === "strong") {
      return [
        {
          tag: "span",
          class: ["font-bold"],
          children: parseTokens(token.tokens ? token.tokens : []),
        },
      ];
    }
    if (token.type === "em") {
      return [
        {
          tag: "span",
          class: ["italic"],
          children: parseTokens(token.tokens ? token.tokens : []),
        },
      ];
    }
    if (token.type === "text") {
      return [token.text];
    }
    if (token.type === "list") {
      return [
        {
          tag: token.ordered ? "ol" : "ul",
          children: parseTokens(token.items),
        },
      ];
    }
    if (token.type === "list_item") {
      return [
        {
          tag: "li",
          children: parseTokens(token.tokens ? token.tokens : []),
        },
      ];
    }
    if (token.type === "space") {
      return [];
    }

    throw Error(`Unexpected token type: ${token.type}`);
  });
}

type NodeOf<O extends Options> = O["image"] extends true
  ? FileSource<{
      width: number;
      height: number;
      sha256: string;
    }>
  : never;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function nodeToTag(node: any): any {
  if (node._type === "file") {
    return node;
  }
  throw Error(`Unexpected node: ${JSON.stringify(node)}`);
}

// eslint-disable-next-line @typescript-eslint/ban-types
export function richtext<O extends Options = {}>(
  templateStrings: TemplateStringsArray,
  ...expr: NodeOf<O>[]
): RichTextSource<O> {
  return templateStrings.flatMap((templateString, i) => {
    const lex = marked.lexer(templateString);
    if (expr[i]) {
      return parseTokens(lex).concat(nodeToTag(expr[i]));
    }
    return parseTokens(lex);
  });
}
