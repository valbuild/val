/* eslint-disable @typescript-eslint/no-unused-vars */
import { Schema, SerializedSchema } from ".";
import { content } from "../module";
import { SourcePath } from "../val";

type RichTextOptions = {
  maxLength?: number;
  minLength?: number;
};

export type SerializedRichTextSchema = {
  type: "richtext";
  options?: RichTextOptions;
  opt: boolean;
};

type Node = {
  version: 1;
};

type NodeType = Node & {
  format: FormatType;
  direction: DirectionType;
  indent: number;
};

type FormatType =
  | "left"
  | "start"
  | "center"
  | "right"
  | "end"
  | "justify"
  | ""
  | number;
type DirectionType = "ltr" | "rtl" | null;

type TextNode = Node & {
  format: FormatType;
  detail: number;
  mode: "normal" | "code" | "quote";
  style: string;
  text: string;
  type: "text";
};

type ImageNode = Node & {
  altText: string;
  height: number;
  width: number;
  maxWidth: number;
  src: string;
  type: "image";
};

type ParagraphNode<VN> = NodeType & {
  children: (TextNode | VN)[];
  type: "paragraph";
};

type HeadingNode<HT extends HeadingTags> = NodeType & {
  children: TextNode[];
  type: "heading";
  tag: HT;
};

type ListItemNode<VN> = NodeType & {
  children: (TextNode | VN)[];
  type: "listitem";
  value: number | string;
};

type ListNode<VN> = NodeType & {
  children: ListItemNode<VN>[];
  type: "list";
  tag: "ol" | "ul";
  listType: "number" | "bullet";
  start?: number;
};

type HeadingTags = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
type RootNode<HT extends HeadingTags, VN> = Node & {
  children: (HeadingNode<HT> | ParagraphNode<VN> | ListNode<VN>)[];
  type: "root";
  format: FormatType;
  direction: DirectionType;
  indent: number;
};

type ValNode = ImageNode;
export type RichText<
  HT extends HeadingTags,
  VN extends TextNode | ValNode = TextNode
> = RootNode<HT, VN>;

export class RichTextSchema<Src extends Schema<string>> extends Schema<
  RichText<HeadingTags>
> {
  validate(
    src: RichText<HeadingTags, TextNode>
  ): false | Record<SourcePath, string[]> {
    throw new Error("Method not implemented.");
  }
  match(src: RichText<HeadingTags, TextNode>): boolean {
    throw new Error("Method not implemented.");
  }
  optional(): Schema<RichText<HeadingTags, TextNode> | null> {
    throw new Error("Method not implemented.");
  }
  serialize(): SerializedSchema {
    throw new Error("Method not implemented.");
  }
  constructor(
    readonly options?: RichTextOptions,
    readonly opt: boolean = false
  ) {
    super();
  }
}

export const richtext = (): Schema<RichText<HeadingTags>> => {
  return new RichTextSchema();
};

{
  const a = content("/test/richtext1", richtext(), {
    children: [
      {
        children: [
          {
            detail: 0,
            format: 0,
            mode: "normal",
            style: "",
            text: "Heading 1",
            type: "text",
            version: 1,
          },
        ],
        direction: "ltr",
        format: "",
        indent: 0,
        type: "heading",
        version: 1,
        tag: "h1",
      },
      {
        children: [
          {
            detail: 0,
            format: 0,
            mode: "normal",
            style: "",
            text: "Heading 2",
            type: "text",
            version: 1,
          },
        ],
        direction: "ltr",
        format: "",
        indent: 0,
        type: "heading",
        version: 1,
        tag: "h2",
      },
      {
        children: [],
        direction: "ltr",
        format: "",
        indent: 0,
        type: "paragraph",
        version: 1,
      },
      {
        children: [
          {
            detail: 0,
            format: 0,
            mode: "normal",
            style: "",
            text: "Normal",
            type: "text",
            version: 1,
          },
        ],
        direction: "ltr",
        format: "",
        indent: 0,
        type: "paragraph",
        version: 1,
      },
      {
        children: [
          {
            detail: 0,
            format: 0,
            mode: "normal",
            style: "font-size: 20px;",
            text: "Normal Font size 20",
            type: "text",
            version: 1,
          },
        ],
        direction: "ltr",
        format: "",
        indent: 0,
        type: "paragraph",
        version: 1,
      },
      {
        children: [
          {
            detail: 0,
            format: 0,
            mode: "normal",
            style: "font-family: serif;",
            text: "Normal font type serif",
            type: "text",
            version: 1,
          },
        ],
        direction: "ltr",
        format: "",
        indent: 0,
        type: "paragraph",
        version: 1,
      },
      {
        children: [
          {
            detail: 0,
            format: 1,
            mode: "normal",
            style: "font-family: serif;",
            text: "Serif and bold",
            type: "text",
            version: 1,
          },
        ],
        direction: "ltr",
        format: "",
        indent: 0,
        type: "paragraph",
        version: 1,
      },
      {
        children: [
          {
            detail: 0,
            format: 2,
            mode: "normal",
            style: "",
            text: "Arial and italic",
            type: "text",
            version: 1,
          },
        ],
        direction: "ltr",
        format: "",
        indent: 0,
        type: "paragraph",
        version: 1,
      },
      {
        children: [],
        direction: null,
        format: "",
        indent: 0,
        type: "paragraph",
        version: 1,
      },
      {
        children: [
          {
            children: [
              {
                detail: 0,
                format: 0,
                mode: "normal",
                style: "",
                text: "Num list 1",
                type: "text",
                version: 1,
              },
            ],
            direction: "ltr",
            format: "",
            indent: 0,
            type: "listitem",
            version: 1,
            value: 1,
          },
          {
            children: [
              {
                detail: 0,
                format: 0,
                mode: "normal",
                style: "",
                text: "Num list 2",
                type: "text",
                version: 1,
              },
              // TODO: image
              // {
              //   altText: "",
              //   height: 0,
              //   maxWidth: 0,
              //   src: "https://picsum.photos/id/237/200/300",
              //   type: "image",
              //   version: 1,
              //   width: 0,
              // },
            ],
            direction: "ltr",
            format: "",
            indent: 0,
            type: "listitem",
            version: 1,
            value: 2,
          },
        ],
        direction: "ltr",
        format: "",
        indent: 0,
        type: "list",
        version: 1,
        listType: "number",
        start: 1,
        tag: "ol",
      },
      {
        children: [],
        direction: null,
        format: "",
        indent: 0,
        type: "paragraph",
        version: 1,
      },
      {
        children: [
          {
            children: [
              {
                detail: 0,
                format: 0,
                mode: "normal",
                style: "",
                text: "Bullet list 1",
                type: "text",
                version: 1,
              },
            ],
            direction: "ltr",
            format: "",
            indent: 0,
            type: "listitem",
            version: 1,
            value: 1,
          },
          {
            children: [
              {
                detail: 0,
                format: 0,
                mode: "normal",
                style: "",
                text: "Bullet list 2",
                type: "text",
                version: 1,
              },
            ],
            direction: "ltr",
            format: "",
            indent: 0,
            type: "listitem",
            version: 1,
            value: 2,
          },
        ],
        direction: "ltr",
        format: "",
        indent: 0,
        type: "list",
        version: 1,
        listType: "bullet",
        start: 1,
        tag: "ul",
      },
      {
        children: [],
        direction: null,
        format: "",
        indent: 0,
        type: "paragraph",
        version: 1,
      },
      {
        children: [],
        direction: "ltr",
        format: "",
        indent: 0,
        type: "paragraph",
        version: 1,
      },
      {
        children: [],
        direction: null,
        format: "",
        indent: 0,
        type: "paragraph",
        version: 1,
      },
    ],
    direction: "ltr",
    format: "",
    indent: 0,
    type: "root",
    version: 1,
  });
}