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

type LexicalTextNode = CommonLexicalProps & {
  type: "text";
  text: string;
  format: "" | number;
};

type LexicalParagraphNode = CommonLexicalProps & {
  type: "paragraph";
  children: LexicalNode[];
};
type LexicalHeadingNode = CommonLexicalProps & {
  type: "heading";
  tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
  children: LexicalNode[];
};
type LexicalListItemNode = CommonLexicalProps & {
  type: "listitem";
  children: LexicalNode[];
};
type LexicalListNode = CommonLexicalProps & {
  type: "list";
  listType: "bullet" | "number" | "checked";
  direction: "ltr" | "rtl" | null;
  children: LexicalNode[];
};

type LexicalImageNode = CommonLexicalProps & {
  type: "image";
} & ImagePayload;

type LexicalLinkNode = CommonLexicalProps & {
  type: "link";
  url: string;
  children: LexicalNode[];
};

type LexicalNode =
  | LexicalTextNode
  | LexicalParagraphNode
  | LexicalHeadingNode
  | LexicalListItemNode
  | LexicalListNode
  | LexicalImageNode
  | LexicalLinkNode;

export type LexicalRootNode = {
  type: "root";
  children: LexicalNode[];
  version: 1;
  format: "left" | "start" | "center" | "right" | "end" | "justify" | "";
  direction: null | "ltr" | "rtl";
} & CommonLexicalProps;

const COMMON_LEXICAL_PROPS = {
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
  node: ValImageNode<AnyRichTextOptions, "node">
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
  link: ValLinkNode<AnyRichTextOptions, "node">
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
  heading: ValHeadingNode<AnyRichTextOptions, "node">
): LexicalHeadingNode {
  return {
    ...COMMON_LEXICAL_PROPS,
    type: "heading",
    tag: heading.tag,
    children: heading.children.map(toLexicalNode),
  };
}

function toLexicalParagraphNode(
  paragraph: ValParagraphNode<AnyRichTextOptions, "node">
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
  listItem: ValListItemNode<AnyRichTextOptions, "node">
): LexicalListItemNode {
  return {
    ...COMMON_LEXICAL_PROPS,
    type: "listitem",
    children: listItem.children.map(toLexicalNode),
  };
}

function toLexicalListNode(
  list:
    | ValUnorderedListNode<AnyRichTextOptions, "node">
    | ValOrderedListNode<AnyRichTextOptions, "node">
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
  spanNode: ValSpanNode<AnyRichTextOptions, "node">
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

// NOTE: the reason this returns a Promise due to the sha256 hash which uses SubtleCrypto and, thus, is async
export async function fromLexical(node: LexicalRootNode): Promise<{
  node: RichTextSource<AnyRichTextOptions>;
  files: Record<string, string>;
}> {
  const files = {};
  return {
    node: {
      _type: "richtext",
      children: (await Promise.all(
        node.children.map((node) => fromLexicalNode(node, files))
      )) as RichTextSource<AnyRichTextOptions>["children"], // TODO: validate
    },
    files,
  };
}

export async function fromLexicalNode(
  node: LexicalNode,
  files: Record<string, string>
) {
  switch (node.type) {
    case "heading":
      return fromLexicalHeadingNode(node, files);
    case "paragraph":
      return fromLexicalParagraphNode(node, files);
    case "text":
      return fromLexicalTextNode(node);
    case "list":
      return fromLexicalListNode(node, files);
    case "listitem":
      return fromLexicalListItemNode(node, files);
    case "image":
      return fromLexicalImageNode(node, files);
    case "link":
      return fromLexicalLinkNode(node, files);
    default:
      throw Error(`Unknown lexical node: ${JSON.stringify(node)}`);
  }
}

const textEncoder = new TextEncoder();
async function fromLexicalImageNode(
  node: LexicalImageNode,
  files: Record<string, string>
) {
  if (node.src.startsWith("data:")) {
    const sha256 = await Internal.getSHA256Hash(textEncoder.encode(node.src));
    const fileExt = mimeTypeToFileExt(node.src);
    const filePath = `/public/${sha256}.${fileExt}`;
    files[filePath] = node.src;
    return {
      [VAL_EXTENSION]: "file",
      [FILE_REF_PROP]: filePath,
      metadata: {
        width: node.width,
        height: node.width,
        sha256,
      },
    };
  } else {
    const sha256 = getParam("sha256", node.src);
    return {
      [VAL_EXTENSION]: "file",
      [FILE_REF_PROP]: `/public${node.src.split("?")[0]}`,
      metadata: {
        width: node.width,
        height: node.width,
        sha256,
      },
    };
  }
}

async function fromLexicalLinkNode(
  node: LexicalLinkNode,
  files: Record<string, string>
): Promise<LinkSource> {
  return {
    [VAL_EXTENSION]: "link",
    href: node.url,
    children: (await Promise.all(
      node.children.map((node) => fromLexicalNode(node, files))
    )) as LinkSource["children"],
  };
}

function fromLexicalTextNode(
  textNode: LexicalTextNode
): ValSpanNode<AnyRichTextOptions, "node"> | string {
  if (textNode.format === "" || textNode.format === 0) {
    return textNode.text;
  }
  return {
    tag: "span",
    classes: fromLexicalFormat(textNode.format),
    children: [textNode.text],
  };
}

async function fromLexicalHeadingNode(
  headingNode: LexicalHeadingNode,
  files: Record<string, string>
): Promise<ValHeadingNode<AnyRichTextOptions, "node">> {
  return {
    tag: headingNode.tag,
    children: (await Promise.all(
      headingNode.children.map((node) => fromLexicalNode(node, files))
    )) as ValHeadingNode<AnyRichTextOptions, "node">["children"], // TODO: validate children
  };
}

async function fromLexicalParagraphNode(
  paragraphNode: LexicalParagraphNode,
  files: Record<string, string>
): Promise<ValBrNode | ValParagraphNode<AnyRichTextOptions, "node">> {
  if (paragraphNode?.children?.length === 0) {
    return {
      tag: "br",
      children: [],
    };
  }
  return {
    tag: "p",
    children: (await Promise.all(
      paragraphNode.children.map((node) => fromLexicalNode(node, files))
    )) as ValParagraphNode<AnyRichTextOptions, "node">["children"], // TODO: validate children
  };
}

async function fromLexicalListNode(
  listNode: LexicalListNode,
  files: Record<string, string>
): Promise<
  | ValOrderedListNode<AnyRichTextOptions, "node">
  | ValUnorderedListNode<AnyRichTextOptions, "node">
> {
  return {
    ...(listNode.direction ? { dir: listNode.direction } : {}),
    tag: listNode.listType === "number" ? "ol" : "ul",
    children: (await Promise.all(
      listNode.children.map((node) => fromLexicalNode(node, files))
    )) as (
      | ValOrderedListNode<AnyRichTextOptions, "node">
      | ValUnorderedListNode<AnyRichTextOptions, "node">
    )["children"], // TODO: validate children
  };
}

async function fromLexicalListItemNode(
  listItemNode: LexicalListItemNode,
  files: Record<string, string>
): Promise<ValListItemNode<AnyRichTextOptions, "node">> {
  return {
    tag: "li",
    children: (await Promise.all(
      listItemNode.children.map((node) => fromLexicalNode(node, files))
    )) as ValListItemNode<AnyRichTextOptions, "node">["children"],
  };
}
