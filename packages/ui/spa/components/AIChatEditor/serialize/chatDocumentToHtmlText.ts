import type {
  ChatDocument,
  ChatBlockNode,
  ChatInlineNode,
  ChatListItemNode,
  ChatNodeStyle,
} from "../types";

const STYLE_TAGS: Record<ChatNodeStyle, string> = {
  bold: "strong",
  italic: "em",
  "line-through": "del",
  code: "code",
};

function escapeText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function writeInline(node: ChatInlineNode): string {
  if (typeof node === "string") {
    return escapeText(node);
  }
  if (node.tag === "br") {
    return "<br/>";
  }
  if (node.tag === "span") {
    const text = escapeText(node.children[0]);
    const tags = node.styles
      .map((s) => STYLE_TAGS[s])
      .filter((t): t is string => !!t);
    const open = tags.map((t) => `<${t}>`).join("");
    const close = tags
      .slice()
      .reverse()
      .map((t) => `</${t}>`)
      .join("");
    return `${open}${text}${close}`;
  }
  if (node.tag === "img") {
    const altPart =
      node.alt !== undefined ? ` alt="${escapeAttr(node.alt)}"` : "";
    return `<img key="${escapeAttr(node.key)}"${altPart}/>`;
  }
  if (node.tag === "field_ref") {
    return `<field path="${escapeAttr(node.path)}"/>`;
  }
  return "";
}

function writeInlineContent(children: ChatInlineNode[]): string {
  return children.map(writeInline).join("");
}

function writeListItem(item: ChatListItemNode): string {
  return `<li>${item.children.map(writeBlock).join("")}</li>`;
}

function writeBlock(node: ChatBlockNode): string {
  switch (node.tag) {
    case "p":
      return `<p>${writeInlineContent(node.children)}</p>`;
    case "h1":
    case "h2":
    case "h3":
      return `<${node.tag}>${writeInlineContent(node.children)}</${node.tag}>`;
    case "ul":
      return `<ul>${node.children.map(writeListItem).join("")}</ul>`;
    case "ol":
      return `<ol>${node.children.map(writeListItem).join("")}</ol>`;
    case "blockquote":
      return `<blockquote>${node.children.map(writeBlock).join("")}</blockquote>`;
  }
}

export function chatDocumentToHtmlText(doc: ChatDocument): string {
  return doc.map(writeBlock).join("\n");
}
