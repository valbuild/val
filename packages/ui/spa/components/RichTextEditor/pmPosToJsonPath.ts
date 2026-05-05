import type { Node as PMNode } from "prosemirror-model";
import type { EditorBlockNode } from "./types";
import { serializeEditorDocument } from "./serialize";

/**
 * Computes the JSON path segments for a node at a given PM position.
 * Walks from the doc root through each depth level, building path
 * segments that match the `serializeEditorDocument` JSON structure.
 *
 * Example paths:
 *   ["0"]                          -> first top-level block
 *   ["0", "children", "2"]         -> third inline child in first paragraph
 *   ["2", "children", "0", "children", "0"] -> first block in first list-item of third block
 */
export function nodeViewPosToJsonPath(
  doc: PMNode,
  pos: number,
): string[] | null {
  try {
    const resolved = doc.resolve(pos);
    const path: string[] = [];

    for (let d = 1; d <= resolved.depth; d++) {
      const parent = resolved.node(d - 1);
      const index = resolved.index(d - 1);

      if (parent.type.name !== "doc") {
        path.push("children");
      }

      path.push(String(index));
    }

    const nodeAtPos = doc.nodeAt(pos);
    if (nodeAtPos) {
      const parent = resolved.node(resolved.depth);
      if (parent.type.name === "doc" && resolved.depth === 0) {
        path.push(String(resolved.index(0)));
      } else if (isInlineContainer(parent) && !isInlineContainer(nodeAtPos)) {
        path.push("children");
        path.push(String(resolved.index(resolved.depth)));
      }
    }

    return path.length > 0 ? path : null;
  } catch {
    return null;
  }
}

/**
 * Returns the JSON path to the closest textblock (paragraph, heading, etc.)
 * containing `pos`, along with its serialized form. Used for link operations
 * which need to replace the entire block's children.
 */
export function pmPosToBlockPath(
  doc: PMNode,
  pos: number,
): { blockPath: string[]; blockNode: EditorBlockNode } | null {
  try {
    const resolved = doc.resolve(pos);

    let blockDepth = -1;
    for (let d = resolved.depth; d >= 1; d--) {
      const node = resolved.node(d);
      if (isSerializableBlock(node)) {
        blockDepth = d;
        break;
      }
    }
    if (blockDepth < 1) return null;

    const path: string[] = [];
    for (let d = 1; d <= blockDepth; d++) {
      const parent = resolved.node(d - 1);
      const index = resolved.index(d - 1);
      if (parent.type.name !== "doc") {
        path.push("children");
      }
      path.push(String(index));
    }

    const blockPmNode = resolved.node(blockDepth);
    const fakeDoc = doc.type.create(null, [blockPmNode]);
    const serialized = serializeEditorDocument(fakeDoc);

    if (serialized.length === 0) return null;

    return { blockPath: path, blockNode: serialized[0] };
  } catch {
    return null;
  }
}

function isInlineContainer(node: PMNode): boolean {
  const name = node.type.name;
  return (
    name === "paragraph" || name === "heading" || name === "details_summary"
  );
}

function isSerializableBlock(node: PMNode): boolean {
  const name = node.type.name;
  return (
    name === "paragraph" ||
    name === "heading" ||
    name === "blockquote" ||
    name === "bullet_list" ||
    name === "ordered_list" ||
    name === "code_block" ||
    name === "details"
  );
}
