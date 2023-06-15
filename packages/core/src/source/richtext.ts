import { VAL_EXTENSION } from ".";
import { SourcePath } from "../val";

type Node = {
  version?: 1;
};

type NodeType = Node & {
  format?: FormatType;
  direction?: DirectionType;
  indent?: number;
};

type FormatType =
  | "left"
  | "start"
  | "center"
  | "right"
  | "end"
  | "justify"
  | "";
type DirectionType = "ltr" | "rtl" | null;

export type TextNode = Node & {
  type: "text";
  format?: FormatType | number;
  detail?: number;
  mode?: "normal" | "code" | "quote";
  style?: string;
  text: string;
  direction?: DirectionType;
  indent?: number;
};

export type ParagraphNode<VN = TextNode> = NodeType & {
  children: (TextNode | VN)[];
  type: "paragraph";
};

export type HeadingNode<HT extends HeadingTags = HeadingTags> = NodeType & {
  children: TextNode[];
  type: "heading";
  tag: HT;
};

export type ListItemNode<VN = TextNode> = NodeType & {
  children: (TextNode | VN)[];
  type: "listitem";
  value: number;
  checked?: boolean;
};

export type ListNode<VN = TextNode> = NodeType & {
  children: ListItemNode<VN>[];
  type: "list";
  tag: "ol" | "ul";
  listType: "number" | "bullet" | "check";
  start?: number;
};

type HeadingTags = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
export type RootNode<HT extends HeadingTags, VN> = Node & {
  children: (HeadingNode<HT> | ParagraphNode<VN> | ListNode<VN>)[];
  type?: "root";
  format?: FormatType;
  direction?: DirectionType;
  indent?: number;
};

const brand = Symbol("richtext");
export type RichText<
  HT extends HeadingTags = HeadingTags,
  VN extends TextNode = TextNode
> = RootNode<HT, VN> & {
  [brand]: "richtext";
  valPath: SourcePath;
};

export type RichTextSource = RichText & {
  readonly [VAL_EXTENSION]: "richtext";
};

export function richtext(
  data: RootNode<HeadingTags, TextNode> | string
): RichTextSource {
  if (typeof data === "string") {
    return {
      [VAL_EXTENSION]: "richtext",
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            {
              type: "text",
              text: data,
            },
          ],
        },
      ],
    } as RichTextSource;
  }
  return {
    ...data,
    [VAL_EXTENSION]: "richtext",
  } as RichTextSource;
}

export function isRichText(obj: unknown): obj is RichTextSource {
  return (
    typeof obj === "object" &&
    obj !== null &&
    VAL_EXTENSION in obj &&
    obj[VAL_EXTENSION] === "richtext"
  );
}
