import {
  ImageMetadata,
  ImageSchema,
  SerializedImageSchema,
} from "../schema/image";
import { RouteSchema, SerializedRouteSchema } from "../schema/route";
import { StringSchema, SerializedStringSchema } from "../schema/string";
import { FileSource } from "./file";
import { ImageSource } from "./image";
import { RemoteSource } from "./remote";

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
    a: boolean | RouteSchema<string> | StringSchema<string>;
    img: boolean | ImageSchema<ImageSource | RemoteSource<ImageMetadata>>;
    // custom: Record<string, Schema<SelectorSource>>;
  }>;
}>;
export type SerializedRichTextOptions = Partial<{
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
    a: boolean | SerializedRouteSchema | SerializedStringSchema;
    img: boolean | SerializedImageSchema;
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

//#region Classes
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

export type GenericRichTextSourceNode = {
  tag: string;
  styles?: string[];
  href?: string;
  src?: ImageSource;
  children?: (string | GenericRichTextSourceNode)[];
};

//#region Paragraph
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

//#region Break
export type BrNode = {
  tag: "br";
};

//#region Span
export type SpanNode<O extends RichTextOptions> = {
  tag: "span";
  styles: Styles<O>[];
  children: [string];
};

//#region Image
export type ImageNode<O extends RichTextOptions> = NonNullable<
  O["inline"]
>["img"] extends true
  ? { tag: "img"; src: ImageSource | RemoteSource<ImageMetadata> }
  : NonNullable<O["inline"]>["img"] extends ImageSchema<infer Src>
    ? Src extends RemoteSource | FileSource
      ? { tag: "img"; src: Src }
      : never
    : never;

//#region Link
type LinkTagNode<O extends RichTextOptions> = {
  tag: "a";
  href: string;
  children: (string | SpanNode<O> | ImageNode<O> | CustomInlineNode<O>)[];
};
export type LinkNode<O extends RichTextOptions> = NonNullable<
  O["inline"]
>["a"] extends true
  ? LinkTagNode<O>
  : NonNullable<O["inline"]>["a"] extends
        | RouteSchema<string>
        | StringSchema<string>
    ? LinkTagNode<O>
    : never;

//#region List
type ListItemTagNode<O extends RichTextOptions> = {
  tag: "li";
  children: (ParagraphNode<O> | UnorderedListNode<O> | OrderedListNode<O>)[];
};
export type ListItemNode<O extends RichTextOptions> = NonNullable<
  O["block"]
>["ul"] extends true
  ? ListItemTagNode<O>
  : never | NonNullable<O["block"]>["ol"] extends true
    ? ListItemTagNode<O>
    : never;

export type UnorderedListNode<O extends RichTextOptions> = NonNullable<
  O["block"]
>["ul"] extends true
  ? {
      tag: "ul";
      // dir?: "ltr" | "rtl"; TODO: add this
      children: ListItemNode<O>[];
    }
  : never;

export type OrderedListNode<O extends RichTextOptions> = NonNullable<
  O["block"]
>["ol"] extends true
  ? {
      tag: "ol";
      // dir?: "ltr" | "rtl"; TODO: add this
      children: ListItemNode<O>[];
    }
  : never;

//#region Heading
export type HeadingTagOf<
  S extends keyof NonNullable<NonNullable<O["block"]>>,
  O extends RichTextOptions,
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

//#region Block and Inline nodes:
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
  | UnorderedListNode<O>
  | OrderedListNode<O>
  | CustomBlockNode<O>;

//#region Main types

/**
 * RichText as defined in a ValModule
 **/
export type RichTextSource<O extends RichTextOptions> = BlockNode<O>[];
