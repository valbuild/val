import { Fragment, Slice } from "prosemirror-model";
import {
  NodeSelection,
  Plugin,
  type EditorState,
  type Transaction,
} from "prosemirror-state";
import { dropPoint } from "prosemirror-transform";
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

/**
 * Where the block at `from` lands if it is let go at `at`: the nearest place
 * it fits, as ProseMirror's own drop finds it (`dropPoint`), or `null` where
 * it fits nowhere or inside itself.
 */
export function blockDropTarget(
  state: EditorState,
  from: number,
  at: number,
): number | null {
  const node = state.doc.nodeAt(from);
  if (node === null) return null;
  const target = dropPoint(state.doc, at, new Slice(Fragment.from(node), 0, 0));
  if (target === null) return null;
  // Inside itself is nowhere.
  if (target > from && target < from + node.nodeSize) return null;
  return target;
}

/**
 * The block at `from` moved to where it lands when let go at `at`, as a
 * drop moves it: taken out, put in at the mapped place, and selected there.
 * `null` when that moves nothing.
 */
export function moveBlock(
  state: EditorState,
  from: number,
  at: number,
): Transaction | null {
  const node = state.doc.nodeAt(from);
  const target = blockDropTarget(state, from, at);
  if (node === null || target === null) return null;
  const tr = state.tr.delete(from, from + node.nodeSize);
  const pos = tr.mapping.map(target);
  tr.replaceRangeWith(pos, pos, node);
  if (tr.doc.eq(state.doc)) return null;
  const placed = tr.doc.nodeAt(pos);
  if (placed !== null && placed.sameMarkup(node)) {
    tr.setSelection(NodeSelection.create(tr.doc, pos));
  }
  return tr.setMeta("uiEvent", "drop");
}

/**
 * Dragging a block by its grip with a finger or a pen.
 *
 * A browser does not start an HTML drag from a touch -- the grip's
 * `dragstart` never fires on a phone -- so this follows the pointer itself:
 * the block fades, a line shows where it would land, the page scrolls when
 * the finger nears an edge, and letting go moves it (`moveBlock`), selected
 * where it lands.
 */
/** Editors with a finger dragging in them: one drag at a time in each. */
const touchDragging = new WeakSet<EditorView>();

function startTouchBlockDrag(
  view: EditorView,
  getPos: () => number | undefined,
  event: PointerEvent,
  image: HTMLElement | undefined,
) {
  const start = getPos();
  if (start === undefined || touchDragging.has(view)) return;
  touchDragging.add(view);
  event.preventDefault();
  event.stopPropagation();
  // Nothing is dispatched until it is let go: a new state redraws the grips,
  // and the one pressed would be gone from under the finger.
  // The editor's page: where the line is drawn, and what scrolls it.
  const page = view.dom.parentElement ?? view.dom;
  const scroller = page.parentElement;
  const position = page.style.position;
  if (getComputedStyle(page).position === "static") {
    page.style.position = "relative";
  }
  const line = document.createElement("div");
  line.className =
    "pointer-events-none absolute z-[2] h-0.5 rounded-full bg-bg-brand-primary";
  line.style.display = "none";
  // What is moving, outlined from outside the editor: a style set on the
  // block itself is a change ProseMirror redraws away, grip and all.
  const outline = document.createElement("div");
  outline.className =
    "pointer-events-none absolute z-[1] rounded border-2 border-dashed border-border-brand-primary bg-bg-brand-primary/10";
  const blockDom = image ?? view.nodeDOM(start);
  if (blockDom instanceof HTMLElement) {
    const box = blockDom.getBoundingClientRect();
    const host = page.getBoundingClientRect();
    outline.style.top = `${box.top - host.top - 2}px`;
    outline.style.left = `${box.left - host.left - 2}px`;
    outline.style.width = `${box.width + 4}px`;
    outline.style.height = `${box.height + 4}px`;
  }
  // In the page, so it scrolls with the block it marks.
  page.append(outline, line);

  let at: number | null = null;
  const show = (target: number | null) => {
    const $pos = target === null ? null : view.state.doc.resolve(target);
    const before = $pos?.nodeBefore ?? null;
    const after = $pos?.nodeAfter ?? null;
    const dom =
      target === null
        ? null
        : before !== null
          ? view.nodeDOM(target - before.nodeSize)
          : after !== null
            ? view.nodeDOM(target)
            : null;
    if (!(dom instanceof HTMLElement)) {
      line.style.display = "none";
      return;
    }
    const box = dom.getBoundingClientRect();
    const host = page.getBoundingClientRect();
    const y = before !== null ? box.bottom + 4 : box.top - 4;
    line.style.display = "";
    line.style.top = `${y - host.top - 1}px`;
    line.style.left = `${box.left - host.left}px`;
    line.style.width = `${box.width}px`;
  };
  const onMove = (move: PointerEvent) => {
    if (move.pointerId !== event.pointerId) return;
    if (scroller) {
      const edge = scroller.getBoundingClientRect();
      if (move.clientY < edge.top + 48) scroller.scrollTop -= 12;
      else if (move.clientY > edge.bottom - 48) scroller.scrollTop += 12;
    }
    // At the finger's height, but inside the text: the finger is on the
    // grip, in the margin beside it, where there is no position.
    const text = view.dom.getBoundingClientRect();
    const found = view.posAtCoords({
      left: Math.min(Math.max(move.clientX, text.left + 4), text.right - 4),
      top: move.clientY,
    });
    at = found === null ? null : found.pos;
    // Where the block is NOW: the sketch can change under the finger -- the
    // assistant writing, a save from elsewhere -- and the position with it.
    const from = getPos();
    show(
      at === null || from === undefined
        ? null
        : blockDropTarget(view.state, from, at),
    );
  };
  const finish = (drop: boolean) => {
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("pointerup", onUp, true);
    window.removeEventListener("pointercancel", onCancel, true);
    line.remove();
    outline.remove();
    page.style.position = position;
    touchDragging.delete(view);
    const from = getPos();
    if (!drop || at === null || from === undefined) return;
    const tr = moveBlock(view.state, from, at);
    if (tr !== null) view.dispatch(tr);
  };
  const onUp = (up: PointerEvent) => {
    if (up.pointerId === event.pointerId) finish(true);
  };
  const onCancel = (cancel: PointerEvent) => {
    if (cancel.pointerId === event.pointerId) finish(false);
  };
  // On the window, not the grip: the grip can be redrawn under the finger
  // (an edit, a save), and the drag must not end with it.
  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("pointerup", onUp, true);
  window.addEventListener("pointercancel", onCancel, true);
}

// lucide's grip-vertical.
const GRIP = "M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01";

/**
 * A grip to drag a block by, drawn in the editor's own chrome: with a mouse
 * an HTML drag (`startBlockDrag`), with a finger or a pen the pointer
 * followed (`startTouchBlockDrag`), since a touch starts no HTML drag.
 */
export function gripElement(
  label: string,
  drag: {
    view: EditorView;
    /** Where the block is now: a node view's `getPos`. */
    getPos: () => number | undefined;
    /** What is dragged as the picture: the block's own element. */
    image?: HTMLElement;
  },
  className: string,
): HTMLElement {
  const grip = document.createElement("span");
  // `touch-none`: a finger on the grip drags the block, not the page.
  grip.className = `${className} touch-none`;
  grip.contentEditable = "false";
  grip.draggable = true;
  grip.title = label;
  grip.setAttribute("aria-label", label);
  grip.setAttribute("role", "button");
  grip.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" class="h-3.5 w-3.5" aria-hidden="true"><path d="${GRIP}"/></svg>`;
  grip.addEventListener("dragstart", (event) => {
    const pos = drag.getPos();
    if (pos !== undefined) startBlockDrag(drag.view, pos, event, drag.image);
  });
  grip.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse") return;
    if (!drag.view.editable) return;
    startTouchBlockDrag(drag.view, drag.getPos, event, drag.image);
  });
  // A press on the grip is not a click into the text beside it.
  grip.addEventListener("mousedown", (event) => event.stopPropagation());
  return grip;
}

/**
 * Finger-sized on a touch screen, and inside the page's wider left margin
 * there (`SketchpadEditor`), rather than a 20px target half off its edge.
 */
const COARSE =
  "[@media(pointer:coarse)]:h-7 [@media(pointer:coarse)]:w-7 [@media(pointer:coarse)]:opacity-60";

const TEXT_GRIP = `absolute -left-6 top-1 flex h-5 w-5 cursor-grab items-center justify-center rounded text-fg-tertiary opacity-0 transition-opacity hover:bg-bg-secondary hover:text-fg-primary [*:hover>&]:opacity-100 [@media(hover:none)]:opacity-60 [@media(pointer:coarse)]:-left-9 [@media(pointer:coarse)]:top-0 ${COARSE}`;

// A column's, in its top right corner: its name is in the top left.
const COL_GRIP = `absolute right-1 top-0.5 z-[1] flex h-4 w-4 cursor-grab items-center justify-center rounded text-fg-tertiary opacity-0 transition-opacity hover:bg-bg-secondary hover:text-fg-primary [*:hover>&]:opacity-100 [@media(hover:none)]:opacity-60 ${COARSE}`;

/** As a text block's, for a box's header and a route divider. */
export const COARSE_GRIP = COARSE;

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
                (view, widgetPos) =>
                  gripElement(
                    node.type === nodes.row
                      ? "Drag to move this row"
                      : node.type === nodes.col
                        ? "Drag to move this column, within its row or to another"
                        : "Drag to move",
                    {
                      view,
                      // The block starts just before its grip, wherever
                      // the sketch has moved it since this was drawn.
                      getPos: () => {
                        const at = widgetPos();
                        return at === undefined ? undefined : at - 1;
                      },
                    },
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
