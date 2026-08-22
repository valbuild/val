import type { Node as PMNode, Mark, Schema } from "prosemirror-model";
import type {
  ChatDocument,
  ChatBlockNode,
  ChatInlineNode,
  ChatListItemNode,
  ChatNodeStyle,
} from "../types";

const STYLE_TO_MARK: Record<ChatNodeStyle, string> = {
  bold: "bold",
  italic: "italic",
  "line-through": "strikethrough",
  code: "code",
};

function styleToMark(style: ChatNodeStyle, schema: Schema): Mark | null {
  const name = STYLE_TO_MARK[style];
  const markType = name ? schema.marks[name] : undefined;
  return markType ? markType.create() : null;
}

export function parseChatDocument(doc: ChatDocument, schema: Schema): PMNode {
  const blocks = doc.map((block) => parseBlockNode(block, schema));
  if (blocks.length === 0) {
    blocks.push(schema.node("paragraph"));
  }
  return schema.node("doc", null, blocks);
}

function parseBlockNode(node: ChatBlockNode, schema: Schema): PMNode {
  switch (node.tag) {
    case "p":
      return schema.node(
        "paragraph",
        null,
        parseInlineNodes(node.children, schema),
      );
    case "h1":
    case "h2":
    case "h3": {
      const level = parseInt(node.tag[1], 10);
      return schema.node(
        "heading",
        { level },
        parseInlineNodes(node.children, schema),
      );
    }
    case "ul":
      return schema.node(
        "bullet_list",
        null,
        node.children.map((li) => parseListItem(li, schema)),
      );
    case "ol":
      return schema.node(
        "ordered_list",
        null,
        node.children.map((li) => parseListItem(li, schema)),
      );
    case "blockquote":
      return schema.node(
        "blockquote",
        null,
        node.children.map((child) => parseBlockNode(child, schema)),
      );
  }
}

function parseListItem(item: ChatListItemNode, schema: Schema): PMNode {
  const children = item.children.map((child) => parseBlockNode(child, schema));
  return schema.node("list_item", null, children);
}

function parseInlineNodes(
  children: ChatInlineNode[],
  schema: Schema,
): PMNode[] {
  const result: PMNode[] = [];
  for (const child of children) {
    if (typeof child === "string") {
      if (child.length > 0) {
        result.push(schema.text(child));
      }
    } else if (child.tag === "br") {
      if (schema.nodes.hard_break) {
        result.push(schema.node("hard_break"));
      }
    } else if (child.tag === "span") {
      const marks = child.styles
        .map((style) => styleToMark(style, schema))
        .filter((m): m is NonNullable<typeof m> => m !== null);
      if (child.children[0].length > 0) {
        result.push(schema.text(child.children[0], marks));
      }
    } else if (child.tag === "img") {
      if (schema.nodes.image) {
        result.push(
          schema.node("image", {
            key: child.key,
            alt: child.alt ?? null,
            previewUrl: child.previewUrl ?? null,
            width: child.width ?? null,
            height: child.height ?? null,
            mimeType: child.mimeType ?? null,
          }),
        );
      }
    } else if (child.tag === "field_ref") {
      if (schema.nodes.field_ref) {
        result.push(schema.node("field_ref", { path: child.path }));
      }
    }
  }
  return result;
}
