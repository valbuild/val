import * as marked from "marked";

type Options = {
  headings?: ("h1" | "h2" | "h3" | "h4" | "h5" | "h6")[];
  link?: boolean;
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
  children: [string];
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
)[];

type options = { headings: [`h${1 | 2 | 3 | 4 | 5 | 6}`] };

function parseTokens<O extends Options>(
  tokens: marked.TokensList
): RichTextSource<O> {
  return tokens.flatMap((token) => {
    if (token.type === "heading") {
      return [
        {
          tag: `h${token.depth}` as options["headings"][number],
          children: parseTokens(token.tokens),
        },
      ];
    }
    if (token.type === "paragraph") {
      return [
        {
          tag: "p",
          children: parseTokens(token.tokens),
        },
      ];
    }
    // For strong, em, og italic så kan vi i teorien bare returnere token.text 
    // altså ikke kjøre rekursivt parseTokens
    if (token.type === "strong") {
      return [
        {
          tag: "span",
          class: ["font-bold"],
          children: parseTokens(token.tokens),
        },
      ];
    }
    if (token.type === "em") {
      return [
        {
          tag: "span",
          class: ["italic"],
          children: parseTokens(token.tokens),
        },
      ];
    }
    if (token.type === "text") {
      return [token.text];
    }
  });
}

export function richtext(
  templateStrings: TemplateStringsArray
): RichTextSource<options> {
  return templateStrings.map((templateString) => {
    const lex = marked.lexer(templateString);
    console.log(JSON.stringify(lex, null, 2));
    return parseTokens(lex);
  })[0];
}
