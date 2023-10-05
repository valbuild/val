import {
  AnyRichTextOptions,
  RichTextNode as ValRichTextNode,
  HeadingNode as ValHeadingNode,
  ListItemNode as ValListItemNode,
  SpanNode as ValSpanNode,
  UnorderedListNode as ValUnorderedListNode,
  OrderedListNode as ValOrderedListNode,
  ParagraphNode as ValParagraphNode,
  RichText,
  RootNode,
  RichTextNode,
} from "@valbuild/core";

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

type LexicalNode =
  | LexicalTextNode
  | LexicalParagraphNode
  | LexicalHeadingNode
  | LexicalListItemNode
  | LexicalListNode;

type LexicalRootNode = {
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
    default:
      throw Error("Not implemented: " + node.tag);
  }
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

export function fromLexical(
  node: LexicalRootNode
): RichText<AnyRichTextOptions> {
  return {
    _type: "richtext",
    children: node.children.map(
      fromLexicalNode
    ) as RootNode<AnyRichTextOptions>[], // TODO: validate
  };
}

export function fromLexicalNode(
  node: LexicalNode
): RichTextNode<AnyRichTextOptions> {
  switch (node.type) {
    case "heading":
      return fromLexicalHeadingNode(node);
    case "paragraph":
      return fromLexicalParagraphNode(node);
    case "text":
      return fromLexicalTextNode(node);
    case "list":
      return fromLexicalListNode(node);
    case "listitem":
      return fromLexicalListItemNode(node);
    default:
      throw Error(`Unknown lexical node: ${JSON.stringify(node)}`);
  }
}

function fromLexicalTextNode(
  textNode: LexicalTextNode
): ValSpanNode<AnyRichTextOptions> | string {
  if (textNode.format === "" || textNode.format === 0) {
    return textNode.text;
  }
  return {
    tag: "span",
    classes: fromLexicalFormat(textNode.format),
    children: [textNode.text],
  };
}

function fromLexicalHeadingNode(
  headingNode: LexicalHeadingNode
): ValHeadingNode<AnyRichTextOptions> {
  return {
    tag: headingNode.tag,
    children: headingNode.children.map(
      fromLexicalNode
    ) as ValHeadingNode<AnyRichTextOptions>["children"], // TODO: validate children
  };
}

function fromLexicalParagraphNode(
  paragraphNode: LexicalParagraphNode
): ValParagraphNode<AnyRichTextOptions> {
  return {
    tag: "p",
    children: paragraphNode.children.map(
      fromLexicalNode
    ) as ValParagraphNode<AnyRichTextOptions>["children"], // TODO: validate children
  };
}

function fromLexicalListNode(
  listNode: LexicalListNode
):
  | ValOrderedListNode<AnyRichTextOptions>
  | ValUnorderedListNode<AnyRichTextOptions> {
  return {
    ...(listNode.direction ? { dir: listNode.direction } : {}),
    tag: listNode.listType === "number" ? "ol" : "ul",
    children: listNode.children.map(fromLexicalNode) as (
      | ValOrderedListNode<AnyRichTextOptions>
      | ValUnorderedListNode<AnyRichTextOptions>
    )["children"], // TODO: validate children
  };
}

function fromLexicalListItemNode(
  listItemNode: LexicalListItemNode
): ValListItemNode<AnyRichTextOptions> {
  return {
    tag: "li",
    children: listItemNode.children.map(
      fromLexicalNode
    ) as ValListItemNode<AnyRichTextOptions>["children"],
  };
}
