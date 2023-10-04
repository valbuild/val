/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  $createParagraphNode,
  $createTextNode,
  LexicalNode,
  TextNode,
} from "lexical";
import { $createListNode, $createListItemNode } from "@lexical/list";
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
} from "@valbuild/core";
import { $createHeadingNode } from "@lexical/rich-text";

export function toLexicalNode(
  node: ValRichTextNode<AnyRichTextOptions>
): LexicalNode {
  if (typeof node === "string") {
    return $createTextNode(node);
  }
  switch (node.tag) {
    case "h1" || "h2" || "h3" || "h4" || "h5" || "h6":
      return toLexicalHeadingNode(node);
    case "li":
      return toLexicalListItemNode(node);
    case "p":
      return toLexicalParagraphNode(node);
    case "ul" || "ol":
      return toLexicalListNode(node);
    case "span":
      return toLexicalTextNode(node);
    default:
      throw Error("Not implemented: " + node.tag);
  }
}

function toLexicalHeadingNode(
  heading: ValHeadingNode<AnyRichTextOptions>
): LexicalNode {
  const node = $createHeadingNode(heading.tag);
  node.append(...heading.children.map((child) => toLexicalNode(child)));
  return node;
}

function toLexicalParagraphNode(
  paragraph: ValParagraphNode<AnyRichTextOptions>
): LexicalNode {
  const node = $createParagraphNode();
  node.append(...paragraph.children.map((child) => toLexicalNode(child)));
  return node;
}

function toLexicalListItemNode(
  listItem: ValListItemNode<AnyRichTextOptions>
): LexicalNode {
  const node = $createListItemNode();
  node.append(...listItem.children.map((child) => toLexicalNode(child)));
  return node;
}

function toLexicalListNode(
  list:
    | ValUnorderedListNode<AnyRichTextOptions>
    | ValOrderedListNode<AnyRichTextOptions>
): LexicalNode {
  const node = $createListNode(
    list.tag === "ol" ? "number" : list.tag === "ul" ? "bullet" : "bullet"
  );
  node.setDirection(list.dir || "ltr");
  node.append(...list.children.map((child) => toLexicalNode(child)));
  return node;
}

function toLexicalTextNode(
  spanNode: ValSpanNode<AnyRichTextOptions>
): LexicalNode {
  const child = spanNode.children[0];
  let node: LexicalNode;
  if (typeof child === "string") {
    node = $createTextNode(child);
  } else {
    node = toLexicalTextNode(child);
  }

  // spanNode.class.includes("font-bold") && node.setBold(true);
  // spanNode.class.includes("italic") && node.setStyle(node.);
  // TODO:
  // text.class.includes("line-through")

  console.log(node);
  return node;
}

export function fromLexicalNode(
  node: LexicalNode
): ValRichTextNode<AnyRichTextOptions> {
  console.log(node.getType());
}
