import { NodeSelection, Plugin } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import { sketchSchema } from "./sketchpadDoc";

const nodes = sketchSchema.nodes;

/**
 * Starts dragging the node at `pos`, the way ProseMirror drags a selected
 * node: dropped elsewhere it moves there, and the drop cursor shows where.
 * What a handle calls on `dragstart`, so a heading or a paragraph -- text,
 * which would otherwise start a text selection -- moves as one block.
 */
export function startBlockDrag(
  view: EditorView,
  pos: number,
  event: DragEvent,
  image?: HTMLElement,
) {
  const selection = NodeSelection.create(view.state.doc, pos);
  view.dispatch(view.state.tr.setSelection(selection));
  view.dragging = { slice: selection.content(), move: true };
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    // Something has to be set, or Firefox does not start the drag at all.
    event.dataTransfer.setData("text/plain", "");
    if (image) {
      event.dataTransfer.setDragImage(image, 8, 8);
    }
  }
}

// lucide's grip-vertical.
const GRIP = "M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01";

/** A grip to drag a block by, drawn in the editor's own chrome. */
export function gripElement(
  label: string,
  onDragStart: (event: DragEvent, grip: HTMLElement) => void,
  className: string,
): HTMLElement {
  const grip = document.createElement("span");
  grip.className = className;
  grip.contentEditable = "false";
  grip.draggable = true;
  grip.title = label;
  grip.setAttribute("aria-label", label);
  grip.setAttribute("role", "button");
  grip.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" class="h-3.5 w-3.5" aria-hidden="true"><path d="${GRIP}"/></svg>`;
  grip.addEventListener("dragstart", (event) => onDragStart(event, grip));
  // A press on the grip is not a click into the text beside it.
  grip.addEventListener("mousedown", (event) => event.stopPropagation());
  return grip;
}

const TEXT_GRIP =
  "absolute -left-6 top-1 flex h-5 w-5 cursor-grab items-center justify-center rounded text-fg-tertiary opacity-0 transition-opacity hover:bg-bg-secondary hover:text-fg-primary [*:hover>&]:opacity-100 [@media(hover:none)]:opacity-60";

// A column's, in its top right corner: its name is in the top left.
const COL_GRIP =
  "absolute right-1 top-0.5 z-[1] flex h-4 w-4 cursor-grab items-center justify-center rounded text-fg-tertiary opacity-0 transition-opacity hover:bg-bg-secondary hover:text-fg-primary [*:hover>&]:opacity-100 [@media(hover:none)]:opacity-60";

/**
 * A grip beside every heading, paragraph, row and column, to drag it somewhere else
 * on the page: into a column, out of one, above the block it was below. A
 * box and a route divider draw their own (`BoxView`, `RouteView`), because
 * they are drawn by a node view and a widget inside one lands in its label.
 */
export function dragHandles(): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        const decorations: Decoration[] = [];
        state.doc.descendants((node, pos) => {
          const isText =
            (node.type === nodes.paragraph || node.type === nodes.heading) &&
            // The empty paragraph someone is about to type in moves nothing.
            node.content.size > 0;
          const isLayout = node.type === nodes.row || node.type === nodes.col;
          if (isText || isLayout) {
            decorations.push(
              Decoration.widget(
                pos + 1,
                (view) =>
                  gripElement(
                    node.type === nodes.row
                      ? "Drag to move this row"
                      : node.type === nodes.col
                        ? "Drag to move this column, within its row or to another"
                        : "Drag to move",
                    (event) => startBlockDrag(view, pos, event),
                    node.type === nodes.col ? COL_GRIP : TEXT_GRIP,
                  ),
                { side: -1, ignoreSelection: true, key: `grip-${pos}` },
              ),
            );
          }
          return node.type !== nodes.box;
        });
        return DecorationSet.create(state.doc, decorations);
      },
    },
  });
}
