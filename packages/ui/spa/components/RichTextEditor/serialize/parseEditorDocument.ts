import type { Node as PMNode, Mark, Schema } from "prosemirror-model";
import { FILE_REF_PROP } from "@valbuild/core";
import type {
  EditorDocument,
  EditorBlockNode,
  EditorInlineNode,
  EditorListItemNode,
  EditorNodeStyle,
} from "../types";

const CUSTOM_STYLE_PREFIX = "custom_style_";

const BUILTIN_STYLE_TO_MARK: Record<string, string> = {
  bold: "bold",
  italic: "italic",
  "line-through": "strikethrough",
  code: "code",
};

function styleToMark(style: EditorNodeStyle, schema: Schema): Mark | null {
  const builtinMarkName = BUILTIN_STYLE_TO_MARK[style];
  if (builtinMarkName) {
    const markType = schema.marks[builtinMarkName];
    return markType ? markType.create() : null;
  }
  const customMarkName = `${CUSTOM_STYLE_PREFIX}${style}`;
  const customMarkType = schema.marks[customMarkName];
  return customMarkType ? customMarkType.create() : null;
}

export function parseEditorDocument(
  doc: EditorDocument,
  schema: Schema,
): PMNode {
  const blocks = doc.map((block) => parseBlockNode(block, schema));
  if (blocks.length === 0) {
    blocks.push(schema.node("paragraph"));
  }
  return schema.node("doc", null, blocks);
}

function parseBlockNode(node: EditorBlockNode, schema: Schema): PMNode {
  switch (node.tag) {
    case "p":
      return schema.node(
        "paragraph",
        null,
        parseInlineNodes(node.children, schema),
      );
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
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
    case "pre":
      return schema.node(
        "code_block",
        null,
        node.children[0] ? [schema.text(node.children[0])] : [],
      );
    case "details": {
      const summaryChild = node.children[0];
      const summaryNode = schema.node(
        "details_summary",
        null,
        parseInlineNodes(summaryChild.children, schema),
      );
      const bodyBlocks = node.children
        .slice(1)
        .map((child) => parseBlockNode(child as EditorBlockNode, schema));
      const variant = node.variant ?? "details";
      return schema.node("details", { variant }, [summaryNode, ...bodyBlocks]);
    }
  }
}

function parseListItem(item: EditorListItemNode, schema: Schema): PMNode {
  const children = item.children.map((child) => parseBlockNode(child, schema));
  return schema.node("list_item", null, children);
}

function parseInlineNodes(
  children: EditorInlineNode[],
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
    } else if (child.tag === "a") {
      if (schema.marks.link) {
        const linkMark = schema.marks.link.create({ href: child.href });
        for (const linkChild of child.children) {
          if (typeof linkChild === "string") {
            if (linkChild.length > 0) {
              result.push(schema.text(linkChild, [linkMark]));
            }
          } else if (linkChild.tag === "span") {
            const marks = linkChild.styles
              .map((style) => styleToMark(style, schema))
              .filter((m): m is NonNullable<typeof m> => m !== null);
            if (linkChild.children[0].length > 0) {
              result.push(
                schema.text(linkChild.children[0], [linkMark, ...marks]),
              );
            }
          }
        }
      }
    } else if (child.tag === "img") {
      if (schema.nodes.image) {
        const srcObj = typeof child.src === "string" ? null : child.src;
        const src = srcObj
          ? ((srcObj as Record<string, unknown>)?.[FILE_REF_PROP] ?? "")
          : child.src;
        const metadata =
          srcObj && "metadata" in srcObj ? srcObj.metadata : null;
        result.push(
          schema.node("image", {
            src,
            alt: child.alt ?? null,
            width: metadata?.width ?? null,
            height: metadata?.height ?? null,
            mimeType: metadata?.mimeType ?? null,
          }),
        );
      }
    } else if (child.tag === "button") {
      if (child.children === false) {
        if (schema.nodes.button_atom) {
          result.push(schema.node("button_atom", { variant: child.variant }));
        }
      } else {
        if (schema.nodes.button_editable) {
          const text = child.children[0];
          result.push(
            schema.node(
              "button_editable",
              { variant: child.variant, href: child.href ?? null },
              text.length > 0 ? [schema.text(text)] : [],
            ),
          );
        }
      }
    }
  }
  return result;
}
