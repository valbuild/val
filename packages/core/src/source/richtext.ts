import * as marked from "marked";
import { FileSource } from "./file";
import { VAL_EXTENSION } from ".";
import { convertFileSource } from "../schema/image";
import { LinkSource } from "./link";

export type RichTextOptions = {
  headings?: ("h1" | "h2" | "h3" | "h4" | "h5" | "h6")[];
  img?: boolean;
  a?: boolean;
  ul?: boolean; // TODO: naming
  ol?: boolean; // TODO: naming
  lineThrough?: boolean;
  bold?: boolean;
  italic?: boolean;
  // link?: boolean;
  // fontFamily?: Record<string, string[]>;
  // fontSize?: Record<string, string[]>;
  // blockQuote?: boolean; // TODO: naming
};

export type ParagraphNode<O extends RichTextOptions> = {
  tag: "p";
  children: (string | SpanNode<O> | LinkNode<O>)[];
  // AnchorNode<O>
};
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export type BrNode<_O extends RichTextOptions> = {
  tag: "br";
  children: [];
};

export type LineThrough<O extends RichTextOptions> =
  O["lineThrough"] extends true ? "line-through" : never;
export type Italic<O extends RichTextOptions> = O["italic"] extends true
  ? "italic"
  : never;
export type Bold<O extends RichTextOptions> = O["bold"] extends true
  ? "bold"
  : never;
// export type FontFamily<O extends RichTextOptions> =
//   O["fontFamily"] extends Record<string, unknown>
//     ? `font-${keyof O["fontFamily"] & string}`
//     : never;
// export type FontSize<O extends RichTextOptions> = O["fontSize"] extends Record<
//   string,
//   unknown
// >
//   ? `text-${keyof O["fontSize"] & string}`
//   : never;

export type Classes<O extends RichTextOptions> =
  | LineThrough<O>
  | Italic<O>
  | Bold<O>;
// | FontFamily<O>
// | FontSize<O>;

export type SpanNode<O extends RichTextOptions> = {
  tag: "span";
  classes: Classes<O>[];
  children: [string | SpanNode<O>];
};

// export type AnchorNode<O extends RichTextOptions> = never; // TODO:
// O["link"] extends true
//   ? {
//       tag: "a";
//       href: string;
//       children: [string];
//     }
//   : never;

export type ImageNode<O extends RichTextOptions> = O["img"] extends true
  ? {
      tag: "img";
      src: string;
      height?: number;
      width?: number;
    }
  : never;

export type LinkNode<O extends RichTextOptions> = O["a"] extends true
  ? {
      tag: "a";
      href: string;
      children: (string | SpanNode<O>)[];
    }
  : never;

export type ListItemNode<O extends RichTextOptions> = {
  tag: "li";
  children: (
    | string
    | SpanNode<O>
    // | AnchorNode<O>
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type HeadingNode<O extends RichTextOptions> = O["headings"] extends any[]
  ? {
      tag: O["headings"][number];
      children: (string | SpanNode<O>)[];
      // | AnchorNode<O>
    }
  : never;

// export type BlockQuoteNode<O extends RichTextOptions> =
//   O["blockQuote"] extends true
//     ? { tag: "blockquote"; children: [string] }
//     : never;

type ImageSource = FileSource<{
  width: number;
  height: number;
  sha256: string;
}>;

export type SourceNode<O extends RichTextOptions> =
  | (O["img"] extends true ? ImageSource : never)
  | (O["a"] extends true ? LinkSource : never);

export type AnyRichTextOptions = {
  headings: ("h1" | "h2" | "h3" | "h4" | "h5" | "h6")[];
  img: true;
  a: true;
  ul: true;
  ol: true;
  lineThrough: true;
  bold: true;
  italic: true;
  // blockQuote: true;
  // fontFamily: Record<string, string[]>;
  // fontSize: Record<string, string[]>;
};

export type RichTextSourceNode<O extends RichTextOptions> =
  | Exclude<RichTextNode<O>, { tag: "img" }>
  | SourceNode<O>;

export type RichTextSource<O extends RichTextOptions> = {
  [VAL_EXTENSION]: "richtext";
  children: (
    | HeadingNode<O>
    | ParagraphNode<O>
    | BrNode<O>
    | UnorderedListNode<O>
    | OrderedListNode<O>
    // | BlockQuoteNode<O>
    | SourceNode<O>
  )[];
};

export type RichTextNode<O extends RichTextOptions> =
  | string
  | RootNode<O>
  | ListItemNode<O>
  | SpanNode<O>
  // | BlockQuoteNode<O>
  | ImageNode<O>;

export type RootNode<O extends RichTextOptions> =
  | HeadingNode<O>
  | ParagraphNode<O>
  | BrNode<O>
  | UnorderedListNode<O>
  | OrderedListNode<O>
  | ImageNode<O>;

// TODO: rename to RichTextSelector?
export type RichText<O extends RichTextOptions> = {
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
          classes: ["bold"],
          children: parseTokens(token.tokens ? token.tokens : []),
        },
      ];
    }
    if (token.type === "em") {
      return [
        {
          tag: "span",
          classes: ["italic"],
          children: parseTokens(token.tokens ? token.tokens : []),
        },
      ];
    }
    if (token.type === "del") {
      return [
        {
          tag: "span",
          classes: ["line-through"],
          children: parseTokens(token.tokens ? token.tokens : []),
        },
      ];
    }
    if (token.type === "text") {
      if ("tokens" in token && Array.isArray(token.tokens)) {
        return parseTokens(token.tokens);
      }
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
          classes: [],
          children: [token.text],
        },
      ];
    }
    if (token.type === "html") {
      const br_html_regex = /<br\s*\/?>/gi; // matches <br>, <br/>, <br />; case insensitive

      console.log("token", token);
      if (token.text.trim().match(br_html_regex)) {
        return [
          {
            tag: "br",
            children: [],
          },
        ];
      }
    }
    console.error(
      `Could not parse markdown: unsupported token type: ${token.type}. Found: ${token.raw}`
    );
    return [token.raw];
  });
}

// TODO make this type safe
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function nodeToTag(node: any): any {
  if (node[VAL_EXTENSION] === "file") {
    return node;
  }
  if (node[VAL_EXTENSION] === "link") {
    return linkSrcToLinkTag(node);
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

function linkSrcToLinkTag<O extends RichTextOptions>(
  linkSrc: LinkSource
): LinkNode<O> {
  const childNodes = linkSrc.children.flatMap((child) => {
    const lex = marked.lexer(child, {
      gfm: true,
    });
    return parseTokens(lex);
  })

  return {
    tag: "a",
    href: linkSrc.href,
    children: childNodes as unknown as (string | SpanNode<O>)[],
  } as LinkNode<O>;
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
      if (VAL_EXTENSION in source && source[VAL_EXTENSION] === "link") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return linkSrcToLinkTag(source);
      }
      return source;
    }),
  } as RichText<O>;
}

export function richtext<
  O extends RichTextOptions,
  Nodes extends never | ImageSource | LinkSource
>(templateStrings: TemplateStringsArray, ...expr: Nodes[]): RichTextSource<O> {
  return {
    [VAL_EXTENSION]: "richtext",
    children: templateStrings.flatMap((templateString, i) => {
      const lex = marked.lexer(templateString, {
        gfm: true,
      });
      console.log("lex", JSON.stringify(lex, null, 2));
      if (expr[i]) {
          // if last token is paragraph? and not <br>
          // <br>
          // link  ->   link
          // p          p
          //
        return parseTokens(lex).concat(nodeToTag(expr[i]));
      }
      return parseTokens(lex);
    }),
  };
}
