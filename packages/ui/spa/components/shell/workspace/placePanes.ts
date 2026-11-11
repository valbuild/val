import {
  anchorOf,
  GAP,
  type SidePane,
  type WorkspaceColumn,
  type WorkspaceLayout,
  type WorkspacePane,
} from "./workspaceLayout";

/**
 * Where Sketch or the Assistant is: a column, or a sheet over the preview.
 *
 * `right` is measured from the right-hand edge of the workspace, inside its
 * gutter, so the pane can be placed with `right` and `width` alone and stay
 * mounted where it is in the tree whatever the layout does to it: the
 * assistant holds a conversation and a sketch its caret and undo, and
 * moving either to another parent would lose them.
 */
export type SidePlacement = {
  right: number;
  width: number;
  /** Sharing its column with the other, as tabs: both, in order. */
  tabs: ("sketch" | "chat")[] | null;
  /** Over the preview rather than beside it: a tablet's sheet. */
  sheet: boolean;
};

export type StripPlacement = {
  right: number;
  width: number;
  panes: SidePane[];
};

/**
 * Content's place: the left column, folded to a strip, a sheet, the middle,
 * or switched off.
 */
export type ContentPlacement =
  | { kind: "column"; width: number }
  | { kind: "strip"; width: number }
  | { kind: "sheet"; width: number }
  | { kind: "anchor" }
  | { kind: "hidden" };

export type PlacedPanes = {
  content: ContentPlacement;
  /**
   * What the columns right of the anchor take, gaps included: the work area
   * left of them is Content's and the preview's.
   */
  rightWidth: number;
  sketch: SidePlacement | null;
  chat: SidePlacement | null;
  /** Folded side panes, at the right-hand edge. */
  strips: StripPlacement[];
};

/**
 * The layout `workspaceLayout` decided, as the places the Studio's panes go.
 *
 * Content and the preview stay where `PageWorkspace` puts them, side by side
 * with the drag handle between; Sketch and the Assistant are to their right,
 * or over the preview as a sheet. So what this answers is how much room is to
 * the right, and where in it each of those two is.
 */
export function placePanes(
  layout: Extract<WorkspaceLayout, { kind: "columns" }>,
  open: Record<WorkspacePane, boolean>,
): PlacedPanes {
  const anchor = anchorOf(open);
  const index = layout.columns.findIndex(
    (column) => column.type === "pane" && column.pane === anchor,
  );
  // Sketch or the Assistant in the middle -- Content and the preview both
  // switched off -- is placed as the side panes are: PageWorkspace has nothing
  // to show, and everything is to its right.
  const sideAnchor = anchor === "sketch" || anchor === "chat";
  const left = index === -1 || sideAnchor ? [] : layout.columns.slice(0, index);
  const right =
    index === -1 ? [] : layout.columns.slice(sideAnchor ? index : index + 1);

  let content: ContentPlacement = { kind: "anchor" };
  const [first] = left;
  if (first?.type === "pane" && first.pane === "content") {
    content = { kind: "column", width: first.width };
  } else if (first?.type === "strip" && first.panes.includes("content")) {
    content = { kind: "strip", width: first.width };
  }

  let sketch: SidePlacement | null = null;
  let chat: SidePlacement | null = null;
  const strips: StripPlacement[] = [];
  const place = (column: WorkspaceColumn, at: number, sheet: boolean) => {
    if (column.type === "strip") {
      strips.push({ right: at, width: column.width, panes: column.panes });
      return;
    }
    if (column.type === "tabs") {
      const placement = {
        right: at,
        width: column.width,
        tabs: column.panes,
        sheet,
      };
      if (column.front === "sketch") sketch = placement;
      else chat = placement;
      return;
    }
    const placement = { right: at, width: column.width, tabs: null, sheet };
    if (column.pane === "sketch") sketch = placement;
    if (column.pane === "chat") chat = placement;
    if (column.pane === "content") {
      content = sheet
        ? { kind: "sheet", width: column.width }
        : { kind: "column", width: column.width };
    }
  };

  // Right to left, so each knows how far it is from the edge.
  let at = 0;
  for (const column of [...right].reverse()) {
    place(column, at, false);
    at += column.width + GAP;
  }
  const rightWidth = at;

  const overlay = layout.overlay;
  if (overlay !== null) {
    const column = { ...overlay.column, width: overlay.width };
    if (overlay.edge === "right") {
      place(column, 0, true);
    } else if (column.type === "pane" && column.pane === "content") {
      content = { kind: "sheet", width: overlay.width };
    }
  }

  if (!open.content) content = { kind: "hidden" };
  return { content, rightWidth, sketch, chat, strips };
}
