import type {
  ChatBlockNode,
  ChatDocument,
  ChatImageNode,
  ChatInlineNode,
  ChatListItemNode,
} from "../types";

function visitInline(node: ChatInlineNode, out: ChatImageNode[]): void {
  if (typeof node === "string") return;
  if (node.tag === "img") {
    out.push(node);
  }
}

function visitListItem(item: ChatListItemNode, out: ChatImageNode[]): void {
  for (const child of item.children) visitBlock(child, out);
}

function visitBlock(block: ChatBlockNode, out: ChatImageNode[]): void {
  switch (block.tag) {
    case "p":
    case "h1":
    case "h2":
    case "h3":
      for (const child of block.children) visitInline(child, out);
      return;
    case "ul":
    case "ol":
      for (const item of block.children) visitListItem(item, out);
      return;
    case "blockquote":
      for (const child of block.children) visitBlock(child, out);
      return;
  }
}

export function collectImageNodesFromDoc(doc: ChatDocument): ChatImageNode[] {
  const out: ChatImageNode[] = [];
  for (const block of doc) visitBlock(block, out);
  return out;
}

export function collectImageKeysFromDoc(doc: ChatDocument): string[] {
  return collectImageNodesFromDoc(doc).map((n) => n.key);
}
