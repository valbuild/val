import type { Node as PMNode, Mark } from "prosemirror-model";
import type { SourcePath } from "@valbuild/core";
import type {
  ChatDocument,
  ChatBlockNode,
  ChatInlineNode,
  ChatListItemNode,
  ChatNodeStyle,
  ChatImageNode,
} from "../types";

export function serializeChatDocument(doc: PMNode): ChatDocument {
  const blocks: ChatBlockNode[] = [];
  doc.forEach((child) => {
    const block = serializeBlockNode(child);
    if (block) blocks.push(block);
  });
  return blocks;
}

function serializeBlockNode(node: PMNode): ChatBlockNode | null {
  switch (node.type.name) {
    case "paragraph":
      return { tag: "p", children: serializeInlineContent(node) };
    case "heading": {
      const level = Math.min(3, Math.max(1, node.attrs.level as number));
      return {
        tag: `h${level}` as "h1" | "h2" | "h3",
        children: serializeInlineContent(node),
      };
    }
    case "bullet_list":
      return { tag: "ul", children: serializeListItems(node) };
    case "ordered_list":
      return { tag: "ol", children: serializeListItems(node) };
    case "blockquote": {
      const children: ChatBlockNode[] = [];
      node.forEach((child) => {
        const block = serializeBlockNode(child);
        if (block) children.push(block);
      });
      return { tag: "blockquote", children };
    }
    default:
      return null;
  }
}

function serializeListItems(node: PMNode): ChatListItemNode[] {
  const items: ChatListItemNode[] = [];
  node.forEach((child) => {
    if (child.type.name === "list_item") {
      const children: ChatBlockNode[] = [];
      child.forEach((liChild) => {
        const block = serializeBlockNode(liChild);
        if (block) children.push(block);
      });
      items.push({
        tag: "li",
        children: children as ChatListItemNode["children"],
      });
    }
  });
  return items;
}

function serializeInlineContent(node: PMNode): ChatInlineNode[] {
  const result: ChatInlineNode[] = [];
  node.forEach((child) => {
    if (child.isText) {
      const text = child.text || "";
      const styles = marksToStyles(child.marks);
      if (styles.length === 0) {
        result.push(text);
      } else {
        result.push({ tag: "span", styles, children: [text] });
      }
    } else if (child.type.name === "hard_break") {
      result.push({ tag: "br" });
    } else if (child.type.name === "image") {
      const key = child.attrs.key as string;
      const width = child.attrs.width as number | null;
      const height = child.attrs.height as number | null;
      const mimeType = child.attrs.mimeType as string | null;
      const previewUrl = child.attrs.previewUrl as string | null;
      const alt = child.attrs.alt as string | null;
      const img: ChatImageNode = { tag: "img", key };
      if (alt) img.alt = alt;
      if (previewUrl) img.previewUrl = previewUrl;
      if (width !== null) img.width = width;
      if (height !== null) img.height = height;
      if (mimeType !== null) img.mimeType = mimeType;
      result.push(img);
    } else if (child.type.name === "field_ref") {
      result.push({
        tag: "field_ref",
        path: child.attrs.path as SourcePath,
      });
    }
  });
  return result;
}

function marksToStyles(marks: readonly Mark[]): ChatNodeStyle[] {
  const styles: ChatNodeStyle[] = [];
  for (const mark of marks) {
    switch (mark.type.name) {
      case "bold":
        styles.push("bold");
        break;
      case "italic":
        styles.push("italic");
        break;
      case "strikethrough":
        styles.push("line-through");
        break;
      case "code":
        styles.push("code");
        break;
    }
  }
  return styles;
}
