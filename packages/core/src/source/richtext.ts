import * as marked from "marked";
import { FileSource } from "./file";
import { VAL_EXTENSION } from ".";
import { convertFileSource } from "../schema/image";

export type RichTextOptions = {
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

export type ParagraphNode<O extends RichTextOptions> = {
  tag: "p";
  children: (string | SpanNode<O> | AnchorNode<O> | ImageNode<O>)[];
};

export type Underline<O extends RichTextOptions> = O["underline"] extends true
  ? "underline"
  : never;
export type LineThrough<O extends RichTextOptions> =
  O["lineThrough"] extends true ? "line-through" : never;
export type Italic<O extends RichTextOptions> = O["italic"] extends true
  ? "italic"
  : never;
export type Bold<O extends RichTextOptions> = O["bold"] extends true
  ? "font-bold"
  : never;
export type FontFamily<O extends RichTextOptions> =
  O["fontFamily"] extends Record<string, unknown>
    ? `font-${keyof O["fontFamily"] & string}`
    : never;
export type FontSize<O extends RichTextOptions> = O["fontSize"] extends Record<
  string,
  unknown
>
  ? `text-${keyof O["fontSize"] & string}`
  : never;

export type Classes<O extends RichTextOptions> =
  | Underline<O>
  | LineThrough<O>
  | Italic<O>
  | Bold<O>
  | FontFamily<O>
  | FontSize<O>;

export type SpanNode<O extends RichTextOptions> = {
  tag: "span";
  class: Classes<O>[];
  children: [string | SpanNode<O>];
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export type AnchorNode<O extends RichTextOptions> = never; // TODO:
// O["link"] extends true
//   ? {
//       tag: "a";
//       href: string;
//       children: [string];
//     }
//   : never;

export type ImageNode<O extends RichTextOptions> = O["image"] extends true
  ? {
      tag: "img";
      src: string;
      height?: number;
      width?: number;
    }
  : never;

export type ListItemNode<O extends RichTextOptions> = {
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

export type UnorderedListNode<O extends RichTextOptions> =
  O["bulletList"] extends true
    ? {
        tag: "ul";
        dir?: "ltr" | "rtl";
        children: ListItemNode<O>[];
      }
    : never;

export type OrderedListNode<O extends RichTextOptions> =
  O["numberList"] extends true
    ? {
        tag: "ol";
        dir?: "ltr" | "rtl";
        children: ListItemNode<O>[];
      }
    : never;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type HeadingNode<O extends RichTextOptions> = O["headings"] extends any[]
  ? {
      tag: O["headings"][number];
      children: (string | SpanNode<O> | AnchorNode<O>)[];
    }
  : never;

export type BlockQuoteNode<O extends RichTextOptions> =
  O["blockQuote"] extends true
    ? { tag: "blockquote"; children: [string] }
    : never;

type ImageSource = FileSource<{
  width: number;
  height: number;
  sha256: string;
}>;

export type SourceNode<O extends RichTextOptions> = O["image"] extends true
  ? ImageSource
  : never;

export type RichTextSource<
  // eslint-disable-next-line @typescript-eslint/ban-types
  O extends RichTextOptions = {}
> = {
  [VAL_EXTENSION]: "richtext";
  children: (
    | HeadingNode<O>
    | ParagraphNode<O>
    | UnorderedListNode<O>
    | OrderedListNode<O>
    | BlockQuoteNode<O>
    | SourceNode<O>
  )[];
};

export type RichTextNode<O extends RichTextOptions> =
  | string
  | HeadingNode<O>
  | ParagraphNode<O>
  | UnorderedListNode<O>
  | OrderedListNode<O>
  | ListItemNode<O>
  | SpanNode<O>
  | BlockQuoteNode<O>
  | ImageNode<O>;

export type RootNode<O extends RichTextOptions> =
  | HeadingNode<O>
  | ParagraphNode<O>
  | UnorderedListNode<O>
  | OrderedListNode<O>
  | BlockQuoteNode<O>
  | ImageNode<O>;

// eslint-disable-next-line @typescript-eslint/ban-types
export type RichText<O extends RichTextOptions = {}> = {
  [VAL_EXTENSION]: "richtext";
  children: RootNode<O>[];
};

function parseTokens<O extends RichTextOptions>(
  tokens: marked.Token[]
): RichTextSource<O>["children"] {
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

    if (token.type === "code") {
      return [
        {
          tag: "span",
          class: [],
          children: [token.text],
        },
      ];
    }

    throw Error(`Unexpected token type: ${token.type}`);
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function nodeToTag(node: any): any {
  if (node._type === "file") {
    return node;
  }
  throw Error(`Unexpected node: ${JSON.stringify(node)}`);
}

function imgSrcToImgTag<O extends RichTextOptions>(
  imageSrc: ImageSource
): ImageNode<O> {
  const converted = convertFileSource(imageSrc);
  return {
    tag: "img",
    src: converted.url,
    width: imageSrc.metadata?.width,
    height: imageSrc.metadata?.height,
  } as ImageNode<O>;
}

export function convertRichTextSource<O extends RichTextOptions>(
  src: RichTextSource<O>
): RichText<O> {
  return {
    [VAL_EXTENSION]: "richtext",
    children: src.children.map((source) => {
      if (VAL_EXTENSION in source && source[VAL_EXTENSION] === "file") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return imgSrcToImgTag(source as any);
      }
      return source;
    }),
  } as RichText<O>;
}

// eslint-disable-next-line @typescript-eslint/ban-types
export function richtext<
  O extends RichTextOptions,
  Nodes extends never | ImageSource
>(templateStrings: TemplateStringsArray, ...expr: Nodes[]): RichTextSource<O> {
  return {
    [VAL_EXTENSION]: "richtext",
    children: templateStrings.flatMap((templateString, i) => {
      const lex = marked.lexer(templateString, {
        gfm: true,
      });
      if (expr[i]) {
        return parseTokens(lex).concat(nodeToTag(expr[i]));
      }
      return parseTokens(lex);
    }),
  };
}
