import {
  AnyRichTextOptions,
  HeadingNode as ValHeadingNode,
  ListItemNode as ValListItemNode,
  SpanNode as ValSpanNode,
  UnorderedListNode as ValUnorderedListNode,
  OrderedListNode as ValOrderedListNode,
  ParagraphNode as ValParagraphNode,
  BrNode as ValBrNode,
  RichTextNode as ValRichTextNode,
  LinkNode as ValLinkNode,
  ImageNode as ValImageNode,
  RichText,
  VAL_EXTENSION,
  Internal,
  FILE_REF_PROP,
  RichTextSource,
} from "@valbuild/core";
import { LinkSource } from "@valbuild/core/src/source/link";
import { mimeTypeToFileExt } from "../../utils/imageMimeType";
import { ImagePayload } from "./Nodes/ImageNode";

/// Serialized Lexical Nodes:
// TODO: replace with Lexical libs types - not currently exported?

export type LexicalTextNode = CommonLexicalProps & {
  type: "text";
  text: string;
  format: "" | number;
};

type InlineNode = LexicalTextNode | LexicalLinkNode;

export type LexicalParagraphNode = CommonLexicalProps & {
  type: "paragraph";
  children: InlineNode[];
};

export type LexicalHeadingNode = CommonLexicalProps & {
  type: "heading";
  tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
  children: InlineNode[];
};

export type LexicalListItemNode = CommonLexicalProps & {
  type: "listitem";
  children: (InlineNode | LexicalListNode)[];
};

export type LexicalListNode = CommonLexicalProps & {
  type: "list";
  listType: "bullet" | "number" | "checked";
  direction: "ltr" | "rtl" | null;
  children: LexicalListItemNode[];
};

export type LexicalImageNode = CommonLexicalProps & {
  type: "image";
} & ImagePayload;

export type LexicalLinkNode = CommonLexicalProps & {
  type: "link";
  url: string;
  children: LexicalTextNode[];
};

export type LexicalNode =
  | LexicalTextNode
  | LexicalParagraphNode
  | LexicalHeadingNode
  | LexicalListItemNode
  | LexicalListNode
  | LexicalImageNode
  | LexicalLinkNode;

export type LexicalRootNode = {
  type: "root";
  children: (LexicalHeadingNode | LexicalParagraphNode | LexicalListNode)[];
  version: 1;
  format: "left" | "start" | "center" | "right" | "end" | "justify" | "";
  direction: null | "ltr" | "rtl";
} & CommonLexicalProps;

export const COMMON_LEXICAL_PROPS = {
  version: 1,
  format: "" as number | "",
  indent: 0,
  direction: null as null | "ltr" | "rtl",
} as const;

type CommonLexicalProps = typeof COMMON_LEXICAL_PROPS;

export function toLexicalNode(
  node: ValRichTextNode<AnyRichTextOptions>
): LexicalNode {
  if (typeof node === "string") {
    return {
      ...COMMON_LEXICAL_PROPS,
      type: "text",
      format: "",
      text: node,
    };
  }
  if ("tag" in node) {
    switch (node.tag) {
      case "h1":
        return toLexicalHeadingNode(node);
      case "h2":
        return toLexicalHeadingNode(node);
      case "h3":
        return toLexicalHeadingNode(node);
      case "h4":
        return toLexicalHeadingNode(node);
      case "h5":
        return toLexicalHeadingNode(node);
      case "h6":
        return toLexicalHeadingNode(node);
      case "li":
        return toLexicalListItemNode(node);
      case "p":
        return toLexicalParagraphNode(node);
      case "ul":
        return toLexicalListNode(node);
      case "ol":
        return toLexicalListNode(node);
      case "span":
        return toLexicalTextNode(node);
      case "a":
        return toLexicalLinkNode(node);
      case "img":
        return toLexicalImageNode(node);
      case "br":
        return toLexicalPseudoLineBreakNode();
      default:
        throw Error("Unexpected node tag: " + JSON.stringify(node, null, 2));
    }
  } else {
    throw Error("Unexpected node: " + JSON.stringify(node, null, 2));
  }
}

function toLexicalImageNode(
  node: ValImageNode<AnyRichTextOptions>
): LexicalImageNode {
  const url = node.src;
  return {
    ...COMMON_LEXICAL_PROPS,
    type: "image",
    src: url,
    width: node.width,
    height: node.height,
    // TODO: altText
  };
}

function toLexicalLinkNode(
  link: ValLinkNode<AnyRichTextOptions>
): LexicalLinkNode {
  return {
    ...COMMON_LEXICAL_PROPS,
    type: "link",
    url: link.href,
    children: link.children.map(toLexicalNode),
  };
}

const URL_FILE_EXT_REGEX = /.*\/(.*)\?/;
function getFileExtFromUrl(url: string): string | undefined {
  const match = url.match(URL_FILE_EXT_REGEX);
  if (match) {
    const fileExtension = match[1].split(".").slice(-1)[0];
    return fileExtension;
  }
}

function getParam(param: string, url: string) {
  const urlParts = url.split("?");
  if (urlParts.length < 2) {
    return undefined;
  }

  const queryString = urlParts[1];
  const params = new URLSearchParams(queryString);

  if (params.has(param)) {
    return params.get(param);
  }

  return undefined;
}

export function toLexical(
  richtext: RichText<AnyRichTextOptions>
): LexicalRootNode {
  return {
    ...COMMON_LEXICAL_PROPS,
    format: "",
    type: "root",
    children: richtext.children.map(toLexicalNode),
  };
}

function toLexicalHeadingNode(
  heading: ValHeadingNode<AnyRichTextOptions>
): LexicalHeadingNode {
  return {
    ...COMMON_LEXICAL_PROPS,
    type: "heading",
    tag: heading.tag,
    children: heading.children.map(toLexicalNode),
  };
}

function toLexicalParagraphNode(
  paragraph: ValParagraphNode<AnyRichTextOptions>
): LexicalParagraphNode {
  return {
    ...COMMON_LEXICAL_PROPS,
    type: "paragraph",
    children: paragraph.children.map(toLexicalNode),
  };
}

// Lexical does not support line breaks, so we convert them to empty paragraphs
function toLexicalPseudoLineBreakNode(): LexicalParagraphNode {
  return {
    ...COMMON_LEXICAL_PROPS,
    type: "paragraph",
    children: [],
  };
}

function toLexicalListItemNode(
  listItem: ValListItemNode<AnyRichTextOptions>
): LexicalListItemNode {
  return {
    ...COMMON_LEXICAL_PROPS,
    type: "listitem",
    children: listItem.children.map(toLexicalNode),
  };
}

function toLexicalListNode(
  list:
    | ValUnorderedListNode<AnyRichTextOptions>
    | ValOrderedListNode<AnyRichTextOptions>
): LexicalListNode {
  return {
    ...COMMON_LEXICAL_PROPS,
    type: "list",
    listType: list.tag === "ol" ? "number" : "bullet",
    children: list.children.map(toLexicalNode),
    ...(list.dir ? { direction: list.dir } : { direction: null }),
  };
}

const FORMAT_MAPPING = {
  bold: 1, // 0001
  italic: 2, // 0010
  "line-through": 4, // 0100
  // underline: 8, // 1000
};

export function toLexicalFormat(
  classes: (keyof typeof FORMAT_MAPPING)[]
): number {
  return classes.reduce(
    (prev, curr) => prev | /* bitwise or */ FORMAT_MAPPING[curr],
    0
  );
}

export function fromLexicalFormat(
  format: number
): (keyof typeof FORMAT_MAPPING)[] {
  return Object.entries(FORMAT_MAPPING).flatMap(([key, value]) => {
    if ((value & /* bitwise and */ format) === value) {
      return [key as keyof typeof FORMAT_MAPPING];
    }
    return [];
  });
}

function toLexicalTextNode(
  spanNode: ValSpanNode<AnyRichTextOptions>
): LexicalTextNode {
  const child = spanNode.children[0];
  if (typeof child === "string") {
    return {
      ...COMMON_LEXICAL_PROPS,
      type: "text",
      text: child,
      format: toLexicalFormat(spanNode.classes),
    };
  } else {
    // recurse the spans and merge their classes
    return toLexicalTextNode({
      ...child,
      classes: spanNode.classes.concat(child.classes),
    });
  }
}
