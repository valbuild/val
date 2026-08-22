import { Internal, type SourcePath } from "@valbuild/core";
import type {
  ChatDocument,
  ChatBlockNode,
  ChatInlineNode,
  ChatListItemNode,
} from "../types";

function prettifyPath(path: SourcePath): string {
  try {
    const [moduleFilePath, modulePath] =
      Internal.splitModuleFilePathAndModulePath(path);
    const modulePathParts = Internal.splitModulePath(modulePath);
    if (modulePathParts.length === 0) return moduleFilePath;
    return `${moduleFilePath}#${modulePathParts.join("/")}`;
  } catch {
    return path;
  }
}

function inlineToText(node: ChatInlineNode): string {
  if (typeof node === "string") return node;
  if (node.tag === "br") return "\n";
  if (node.tag === "span") return node.children[0];
  if (node.tag === "img") return node.alt ? `[image: ${node.alt}]` : "[image]";
  if (node.tag === "field_ref") return `@${prettifyPath(node.path)}`;
  return "";
}

function inlineContentToText(children: ChatInlineNode[]): string {
  return children.map(inlineToText).join("");
}

function listItemToText(
  item: ChatListItemNode,
  marker: string,
  indent: string,
): string {
  const lines: string[] = [];
  // The marker goes on the item's first line of text; everything after it is
  // continuation, aligned under the marker.
  let isFirstLine = true;
  const pushTextLine = (text: string) => {
    lines.push(`${isFirstLine ? `${indent}${marker} ` : `${indent}  `}${text}`);
    isFirstLine = false;
  };
  for (const child of item.children) {
    switch (child.tag) {
      case "p":
      case "h1":
      case "h2":
      case "h3":
        pushTextLine(inlineContentToText(child.children));
        break;
      case "blockquote":
        // A list item may hold any block (`"paragraph block*"`), so a
        // blockquote has to be rendered rather than dropped.
        for (const line of blockToText(child).split("\n")) {
          pushTextLine(line);
        }
        break;
      case "ul":
        for (const nested of child.children) {
          lines.push(listItemToText(nested, "-", `${indent}  `));
        }
        break;
      case "ol": {
        let i = 0;
        for (const nested of child.children) {
          lines.push(listItemToText(nested, `${i + 1}.`, `${indent}  `));
          i += 1;
        }
        break;
      }
    }
  }
  return lines.join("\n");
}

function blockToText(block: ChatBlockNode): string {
  switch (block.tag) {
    case "p":
      return inlineContentToText(block.children);
    case "h1":
    case "h2":
    case "h3":
      return inlineContentToText(block.children);
    case "blockquote":
      return block.children.map(blockToText).join("\n");
    case "ul":
      return block.children
        .map((item) => listItemToText(item, "-", ""))
        .join("\n");
    case "ol":
      return block.children
        .map((item, i) => listItemToText(item, `${i + 1}.`, ""))
        .join("\n");
  }
}

export function chatDocumentToPlainText(doc: ChatDocument): string {
  return doc.map(blockToText).join("\n\n");
}
