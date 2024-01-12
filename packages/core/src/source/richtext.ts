import { VAL_EXTENSION } from ".";
import { LinkSource } from "./link";
import { ImageSource } from "./image";

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
  children: (string | SpanNode<O> | BrNode | LinkNode<O> | ImageNode<O>)[];
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
  children: [string];
};

/// Image
type ImageTagNode = {
  tag: "img";
  src: string;
  height?: number;
  width?: number;
  mimeType?: string;
  children: [];
};
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
    | BrNode
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
  | BrNode
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
  exprs: (
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

export function richtext<O extends RichTextOptions>(
  templateStrings: TemplateStringsArray,
  ...nodes: (ImageSource | LinkSource)[]
): RichTextSource<O> {
  return {
    [VAL_EXTENSION]: "richtext",
    templateStrings: templateStrings as unknown as string[],
    exprs:
      nodes as RichTextSource<AnyRichTextOptions>["exprs"] as RichTextSource<O>["exprs"],
  };
}
