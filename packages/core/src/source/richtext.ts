import { VAL_EXTENSION } from ".";
import { LinkSource } from "./link";
import { ImageSource } from "./image";
import { ImageMetadata } from "../schema/image";
import { FILE_REF_PROP, FILE_REF_SUBTYPE_TAG, FileSource } from "./file";
import { parseRichTextSource } from "./parseRichTextSource";

export type RichTextOptions = Partial<{
  style: Partial<{
    bold: boolean;
    italic: boolean;
    lineThrough: boolean;
  }>;
  block: Partial<{
    h1: boolean;
    h2: boolean;
    h3: boolean;
    h4: boolean;
    h5: boolean;
    h6: boolean;
    ul: boolean;
    ol: boolean;
    // TODO:
    // custom: Record<string, Schema<SelectorSource>>;
  }>;
  inline: Partial<{
    a: boolean;
    img: boolean;
    // custom: Record<string, Schema<SelectorSource>>;
  }>;
}>;
export type AllRichTextOptions = {
  style: {
    bold: true;
    italic: true;
    lineThrough: true;
  };
  block: {
    h1: true;
    h2: true;
    h3: true;
    h4: true;
    h5: true;
    h6: true;
    ul: true;
    ol: true;
  };
  inline: {
    a: true;
    img: true;
  };
};

// Classes
export type LineThrough<O extends RichTextOptions> = NonNullable<
  O["style"]
>["lineThrough"] extends true
  ? "line-through"
  : never;

export type Italic<O extends RichTextOptions> = NonNullable<
  O["style"]
>["italic"] extends true
  ? "italic"
  : never;

export type Bold<O extends RichTextOptions> = NonNullable<
  O["style"]
>["bold"] extends true
  ? "bold"
  : never;

export type Styles<O extends RichTextOptions> =
  | LineThrough<O>
  | Italic<O>
  | Bold<O>;

/// Paragraph
export type ParagraphNode<O extends RichTextOptions> = {
  tag: "p";
  children: (
    | string
    | SpanNode<O>
    | BrNode
    | LinkNode<O>
    | ImageNode<O>
    | CustomInlineNode<O>
  )[];
};

/// Break
export type BrNode = {
  tag: "br";
};

/// Span
export type SpanNode<O extends RichTextOptions> = {
  tag: "span";
  styles: Styles<O>[];
  children: [string];
};

/// Image
export type ImageNode<O extends RichTextOptions> = NonNullable<
  O["inline"]
>["img"] extends true
  ? { tag: "img"; children: [FileSource<ImageMetadata>] }
  : never;

/// Link
type LinkTagNode<O extends RichTextOptions> = {
  tag: "a";
  href: string;
  children: (string | SpanNode<O> | ImageNode<O> | CustomInlineNode<O>)[];
};
export type LinkNode<O extends RichTextOptions> = NonNullable<
  O["inline"]
>["a"] extends true
  ? LinkTagNode<O>
  : never;

/// List
type ListItemTagNode<O extends RichTextOptions> = {
  tag: "li";
  children: (
    | string
    | SpanNode<O>
    | ParagraphNode<O>
    | LinkNode<O>
    | BrNode
    | UnorderedListNode<O>
    | OrderedListNode<O>
    | CustomInlineNode<O>
  )[];
};
export type ListItemNode<O extends RichTextOptions> =
  | NonNullable<O["block"]>["ul"] extends true
  ? ListItemTagNode<O>
  : never | NonNullable<O["block"]>["ol"] extends true
  ? ListItemTagNode<O>
  : never;

export type UnorderedListNode<O extends RichTextOptions> = NonNullable<
  O["block"]
>["ul"] extends true
  ? {
      tag: "ul";
      dir?: "ltr" | "rtl";
      children: ListItemNode<O>[];
    }
  : never;

export type OrderedListNode<O extends RichTextOptions> = NonNullable<
  O["block"]
>["ol"] extends true
  ? {
      tag: "ol";
      dir?: "ltr" | "rtl";
      children: ListItemNode<O>[];
    }
  : never;

/// Heading
export type HeadingTagOf<
  S extends keyof NonNullable<NonNullable<O["block"]>>,
  O extends RichTextOptions
> = NonNullable<NonNullable<O["block"]>>[S] extends true
  ? {
      tag: S;

      children: (
        | string
        | SpanNode<O>
        | CustomInlineNode<O>
        | LinkNode<O>
        | BrNode
        | ImageNode<O>
      )[];
    }
  : never;

export type HeadingNode<O extends RichTextOptions> =
  | HeadingTagOf<"h1", O>
  | HeadingTagOf<"h2", O>
  | HeadingTagOf<"h3", O>
  | HeadingTagOf<"h4", O>
  | HeadingTagOf<"h5", O>
  | HeadingTagOf<"h6", O>;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export type CustomInlineNode<O extends RichTextOptions> = never;
// export type CustomInlineNode<O extends RichTextOptions> = NonNullable<
//   NonNullable<O["inline"]>["custom"]
// >[keyof NonNullable<NonNullable<O["inline"]>["custom"]>] extends Schema<
//   infer Src
// >
//   ? ReplaceRawStringWithString<Src>
//   : never;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export type CustomBlockNode<O extends RichTextOptions> = never;

/// Block and Inline nodes:
export type RichTextNode<O extends RichTextOptions> =
  | string
  | BlockNode<O>
  | ListItemNode<O>
  | BrNode
  | SpanNode<O>
  | LinkNode<O>
  | ImageNode<O>
  | CustomInlineNode<O>;

export type BlockNode<O extends RichTextOptions> =
  | HeadingNode<O>
  | ParagraphNode<O>
  | BrNode
  | UnorderedListNode<O>
  | OrderedListNode<O>
  | CustomBlockNode<O>;

/// Main types

/**
 * RichTextSource is defined in ValModules
 **/
export type RichTextSource<O extends RichTextOptions> = BlockNode<O>[];
/**
 * RichText is accessible by users (after conversion via useVal / fetchVal)
 * Internally it is a Selector
 **/
export type RichText<O extends RichTextOptions> = BlockNode<O>[];

export function richtext<O extends RichTextOptions>(
  templateStrings: TemplateStringsArray,
  ...nodes: (ImageSource | LinkSource)[]
): RichTextSource<O> {
  return parseRichTextSource({
    templateStrings: templateStrings as unknown as string[],
    exprs: nodes as (
      | (NonNullable<O["inline"]>["img"] extends true ? ImageSource : never)
      | (NonNullable<O["inline"]>["a"] extends true ? LinkSource : never)
    )[],
  });
}

export const RT_IMAGE_TAG = "rt_image";

export type RTImageMetadata = ImageMetadata;
export function image(
  ref: `/public/${string}`,
  metadata?: RTImageMetadata
): FileSource<RTImageMetadata> {
  return {
    [FILE_REF_PROP]: ref,
    [FILE_REF_SUBTYPE_TAG]: RT_IMAGE_TAG,
    [VAL_EXTENSION]: "file",
    metadata,
  } as FileSource<RTImageMetadata>;
}
