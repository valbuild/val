import type { Node as PMNode } from "prosemirror-model";
import { type EditorState, TextSelection } from "prosemirror-state";
import type { InlinePoint, InlineSelection } from "@valbuild/shared/internal";

/**
 * A selection on the page, as a selection in the Studio's editor, and back.
 *
 * The page names a place by its paragraph or heading -- counted in the order
 * they are read -- and how far into it, a character as one and an image or
 * a line break as one (`InlinePoint`). That is exactly how ProseMirror
 * counts inside a text block, so the two meet without either knowing how
 * the other holds the document: the n-th text block is the n-th text block,
 * and the offset is the offset.
 */

/** Each text block of `doc`, in order: where its content starts, and its size. */
function textBlocks(doc: PMNode): { start: number; size: number }[] {
  const blocks: { start: number; size: number }[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    blocks.push({ start: pos + 1, size: node.content.size });
    return false;
  });
  return blocks;
}

/**
 * The page's selection in `doc`, or `null` when it names a block the
 * document does not have: the two can be a keystroke apart, and a control
 * acting on a guess is worse than one that waits.
 */
export function toEditorSelection(
  doc: PMNode,
  selection: InlineSelection | null,
): TextSelection | null {
  if (selection === null) return null;
  const blocks = textBlocks(doc);
  const position = (point: InlinePoint): number | null => {
    const block = blocks[point.block];
    if (block === undefined) return null;
    return block.start + Math.min(point.offset, block.size);
  };
  const anchor = position(selection.anchor);
  const head = position(selection.head);
  if (anchor === null || head === null) return null;
  return TextSelection.create(doc, anchor, head);
}

/**
 * The editor's selection, as the page names places -- or `null` when it is
 * not in text at all (a selected image), which the page has no caret for.
 */
export function fromEditorSelection(
  state: EditorState,
): InlineSelection | null {
  const blocks = textBlocks(state.doc);
  const point = (position: number): InlinePoint | null => {
    const index = blocks.findIndex(
      (block) =>
        position >= block.start && position <= block.start + block.size,
    );
    if (index < 0) return null;
    return { block: index, offset: position - blocks[index].start };
  };
  const anchor = point(state.selection.anchor);
  const head = point(state.selection.head);
  return anchor !== null && head !== null ? { anchor, head } : null;
}
