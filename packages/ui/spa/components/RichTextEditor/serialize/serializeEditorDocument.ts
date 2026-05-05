import type { Node as PMNode, Mark } from "prosemirror-model";
import { FILE_REF_PROP, FILE_REF_SUBTYPE_TAG, VAL_EXTENSION } from "@valbuild/core";
import type {
  EditorDocument,
  EditorBlockNode,
  EditorInlineNode,
  EditorListItemNode,
  EditorNodeStyle,
  EditorSpanNode,
  EditorSummaryNode,
  EditorDetailsNode,
} from "../types";

export function serializeEditorDocument(doc: PMNode): EditorDocument {
  const blocks: EditorBlockNode[] = [];
  doc.forEach((child) => {
    const block = serializeBlockNode(child);
    if (block) blocks.push(block);
  });
  return blocks;
}

function serializeBlockNode(node: PMNode): EditorBlockNode | null {
  switch (node.type.name) {
    case "paragraph":
      return { tag: "p", children: serializeInlineContent(node) };
    case "heading": {
      const level = node.attrs.level as number;
      return {
        tag: `h${level}` as EditorBlockNode["tag"],
        children: serializeInlineContent(node),
      } as EditorBlockNode;
    }
    case "bullet_list":
      return {
        tag: "ul",
        children: serializeListItems(node),
      };
    case "ordered_list":
      return {
        tag: "ol",
        children: serializeListItems(node),
      };
    case "blockquote": {
      const children: EditorBlockNode[] = [];
      node.forEach((child) => {
        const block = serializeBlockNode(child);
        if (block) children.push(block);
      });
      return { tag: "blockquote", children };
    }
    case "code_block":
      return { tag: "pre", children: [node.textContent] };
    case "details": {
      const variant = node.attrs.variant as string;
      let summaryNode: EditorSummaryNode = { tag: "summary", children: [] };
      const bodyBlocks: EditorBlockNode[] = [];
      node.forEach((child) => {
        if (child.type.name === "details_summary") {
          summaryNode = {
            tag: "summary",
            children: serializeInlineContent(child),
          };
        } else {
          const block = serializeBlockNode(child);
          if (block) bodyBlocks.push(block);
        }
      });
      const result: EditorDetailsNode = {
        tag: "details",
        children: [summaryNode, ...bodyBlocks],
      };
      if (variant !== "details") {
        result.variant = variant;
      }
      return result;
    }

    default:
      return null;
  }
}

function serializeListItems(node: PMNode): EditorListItemNode[] {
  const items: EditorListItemNode[] = [];
  node.forEach((child) => {
    if (child.type.name === "list_item") {
      const children: EditorBlockNode[] = [];
      child.forEach((liChild) => {
        const block = serializeBlockNode(liChild);
        if (block) children.push(block);
      });
      items.push({
        tag: "li",
        children: children as EditorListItemNode["children"],
      });
    }
  });
  return items;
}

function serializeInlineContent(node: PMNode): EditorInlineNode[] {
  const result: EditorInlineNode[] = [];
  node.forEach((child) => {
    if (child.isText) {
      const text = child.text || "";
      const marks = child.marks;
      if (marks.length === 0) {
        result.push(text);
      } else {
        const linkMark = marks.find((m) => m.type.name === "link");
        const styleMasks = marks.filter((m) => m.type.name !== "link");

        if (linkMark) {
          const href = linkMark.attrs.href as string;
          if (styleMasks.length === 0) {
            mergeIntoLink(result, href, text);
          } else {
            const span: EditorSpanNode = {
              tag: "span",
              styles: marksToStyles(styleMasks),
              children: [text],
            };
            mergeIntoLinkWithSpan(result, href, span);
          }
        } else {
          const styles = marksToStyles(styleMasks);
          if (styles.length > 0) {
            result.push({ tag: "span", styles, children: [text] });
          } else {
            result.push(text);
          }
        }
      }
    } else if (child.type.name === "hard_break") {
      result.push({ tag: "br" });
    } else if (child.type.name === "image") {
      const ref = child.attrs.src as string;
      const width = child.attrs.width as number | null;
      const height = child.attrs.height as number | null;
      const mimeType = child.attrs.mimeType as string | null;
      const hasMetadata =
        width !== null && height !== null && mimeType !== null;
      const inlineImg: EditorInlineNode = {
        tag: "img",
        src: {
          [FILE_REF_PROP]: ref,
          [VAL_EXTENSION]: "file",
          [FILE_REF_SUBTYPE_TAG]: "image",
          ...(hasMetadata
            ? { metadata: { width, height, mimeType } }
            : {}),
        },
        ...(child.attrs.alt ? { alt: child.attrs.alt as string } : {}),
      };
      result.push(inlineImg);
    } else if (child.type.name === "button_atom") {
      result.push({
        tag: "button",
        variant: child.attrs.variant as string,
        children: false,
      });
    } else if (child.type.name === "button_editable") {
      const btnNode: EditorInlineNode = {
        tag: "button",
        variant: child.attrs.variant as string,
        children: [child.textContent],
      };
      if (child.attrs.href) {
        (btnNode as { href: string }).href = child.attrs.href as string;
      }
      result.push(btnNode);
    }
  });
  return result;
}

function mergeIntoLink(
  result: EditorInlineNode[],
  href: string,
  text: string,
): void {
  const last = result[result.length - 1];
  if (
    last &&
    typeof last === "object" &&
    last.tag === "a" &&
    last.href === href
  ) {
    last.children.push(text);
  } else {
    result.push({ tag: "a", href, children: [text] });
  }
}

function mergeIntoLinkWithSpan(
  result: EditorInlineNode[],
  href: string,
  span: EditorSpanNode,
): void {
  const last = result[result.length - 1];
  if (
    last &&
    typeof last === "object" &&
    last.tag === "a" &&
    last.href === href
  ) {
    last.children.push(span);
  } else {
    result.push({ tag: "a", href, children: [span] });
  }
}

const CUSTOM_STYLE_PREFIX = "custom_style_";

function marksToStyles(marks: readonly Mark[]): EditorNodeStyle[] {
  const styles: EditorNodeStyle[] = [];
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
      default:
        if (mark.type.name.startsWith(CUSTOM_STYLE_PREFIX)) {
          styles.push(mark.type.name.slice(CUSTOM_STYLE_PREFIX.length));
        }
        break;
    }
  }
  return styles;
}
