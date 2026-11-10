import {
  SHELL_DESKTOP_BREAKPOINT,
  SHELL_MOBILE_BREAKPOINT,
} from "../useShellBreakpoint";
/**
 * Where the workspace's panes go, at a given window width.
 *
 * A PROTOTYPE of the layout that replaces code mode's and the Sketchpad's
 * workspace overrides: one workspace, four panes, and the preview in the
 * middle of it while it is open.
 *
 * - **Content**: the editor, structural or "on this page".
 * - **Preview**: the site, the same component everywhere. The ANCHOR while it
 *   is open: never covered for good and never narrower than `PREVIEW_MIN`.
 *   It can be closed from a tablet up -- for content that is on no page, or
 *   to write at full width -- and then the first open pane of Content,
 *   Sketch and Chat is the anchor in its place. On a phone it is always
 *   one of the tabs.
 * - **Sketch** and **Chat**: worked on together (a sketch is sent to the
 *   assistant), so when there is no room for both they share one column as
 *   two tabs.
 *
 * There are no layouts per breakpoint. Two rules decide every width:
 *
 * 1. Take the widest arrangement that leaves the anchor its minimum: every
 *    open pane its own column; then Sketch and Chat as tabs; then the anchor
 *    and ONE column, the most recently used.
 * 2. What does not fit is not closed. It folds to a strip at its own edge,
 *    one click from coming back -- or, with `narrow: "overlay"`, Content
 *    floats over the left of the preview instead of taking the other
 *    column's place.
 *
 * Pure, so the stories, the tests and the page that compares the options
 * all run the same rule.
 */

export type SidePane = "content" | "sketch" | "chat";
export type WorkspacePane = SidePane | "preview";

/** What happens to Content when only one column fits beside the preview. */
export type NarrowStrategy = "strips" | "overlay";

export type WorkspaceLayoutInput = {
  /** The window's width, in CSS pixels. */
  width: number;
  /**
   * Which panes are open. With none of them, the preview is. On a phone the
   * preview is a tab whatever this says.
   */
  open: Record<WorkspacePane, boolean>;
  /** Most recently used first. Decides what stays when not everything fits. */
  recent: readonly SidePane[];
  /** Which of Sketch and Chat is in front when they share a column. */
  front: "sketch" | "chat";
  narrow: NarrowStrategy;
  /** On a phone, the one pane on screen. */
  phonePane: WorkspacePane;
};

/** One column of the workspace, left to right. */
export type WorkspaceColumn =
  | { type: "pane"; pane: WorkspacePane; width: number }
  | {
      type: "tabs";
      panes: ("sketch" | "chat")[];
      front: "sketch" | "chat";
      width: number;
    }
  | { type: "strip"; panes: SidePane[]; edge: "left" | "right"; width: number };

/** A pane over the preview rather than beside it. */
export type WorkspaceOverlay = {
  edge: "left" | "right";
  width: number;
  column: Exclude<WorkspaceColumn, { type: "strip" }>;
};

export type WorkspaceLayout =
  | {
      kind: "phone";
      pane: WorkspacePane;
      /** The bottom bar: the preview and every open pane. */
      tabs: WorkspacePane[];
    }
  | {
      kind: "columns";
      breakpoint: "tablet" | "desktop";
      /** The desktop's left rail, outside the columns. */
      rail: boolean;
      columns: WorkspaceColumn[];
      overlay: WorkspaceOverlay | null;
      /** Which arrangement rule 1 settled on, for the stories to label. */
      arrangement: "all" | "tabbed" | "one-column" | "single";
    };

/**
 * The Studio's own breakpoints (`useShellBreakpoint`), not a copy of them:
 * the shell decides "mobile" from those, and a layout that disagreed would
 * place panes on a breakpoint that renders none.
 */
export const PHONE_BELOW = SHELL_MOBILE_BREAKPOINT;
export const DESKTOP_FROM = SHELL_DESKTOP_BREAKPOINT;

/** The left rail on a desktop, with its gap (`pl-[5.5rem]` in `Shell`). */
export const RAIL_WIDTH = 88;
/** The gutter on the other side, and on both sides without a rail. */
export const GUTTER = 12;
export const GAP = 8;
export const STRIP_WIDTH = 40;
/** Below this a page in the preview stops reading as a page. */
export const PREVIEW_MIN = 560;
export const CONTENT_MIN = 340;
export const CONTENT_MAX = 480;
/** The least an anchor other than the preview is left with. */
export const ANCHOR_MIN = 420;
/** `AI_PANEL_WIDTH`, and room for two columns of sketch boxes. */
export const SIDE_WIDTH = 420;

const SIDE_PANES: readonly ("sketch" | "chat")[] = ["sketch", "chat"];

function contentWidth(available: number): number {
  return Math.round(
    Math.min(CONTENT_MAX, Math.max(CONTENT_MIN, available * 0.28)),
  );
}

/** The column at the anchor, with what the other columns leave. */
function withAnchor(
  anchor: WorkspacePane,
  available: number,
  left: WorkspaceColumn[],
  right: WorkspaceColumn[],
): WorkspaceColumn[] {
  const taken =
    [...left, ...right].reduce((sum, column) => sum + column.width, 0) +
    GAP * (left.length + right.length);
  return [
    ...left,
    { type: "pane", pane: anchor, width: available - taken },
    ...right,
  ];
}

function widthOf(anchor: WorkspacePane, columns: WorkspaceColumn[]): number {
  const column = columns.find(
    (each) => each.type === "pane" && each.pane === anchor,
  );
  return column?.width ?? 0;
}

/** The pane in the middle: the preview while it is open. */
export function anchorOf(open: Record<WorkspacePane, boolean>): WorkspacePane {
  if (open.preview) return "preview";
  if (open.content) return "content";
  if (open.sketch) return "sketch";
  if (open.chat) return "chat";
  return "preview";
}

export function workspaceLayout(input: WorkspaceLayoutInput): WorkspaceLayout {
  const { width, open, recent, front, narrow } = input;

  if (width < PHONE_BELOW) {
    const tabs: WorkspacePane[] = [];
    if (open.content) tabs.push("content");
    tabs.push("preview");
    if (open.sketch) tabs.push("sketch");
    if (open.chat) tabs.push("chat");
    const pane = tabs.includes(input.phonePane) ? input.phonePane : "preview";
    return { kind: "phone", pane, tabs };
  }

  const breakpoint: "tablet" | "desktop" =
    width < DESKTOP_FROM ? "tablet" : "desktop";
  const rail = breakpoint === "desktop";
  const available = width - (rail ? RAIL_WIDTH : GUTTER) - GUTTER;
  const anchor = anchorOf(open);
  const minimum = anchor === "preview" ? PREVIEW_MIN : ANCHOR_MIN;
  const place = (left: WorkspaceColumn[], right: WorkspaceColumn[]) =>
    withAnchor(anchor, available, left, right);
  const fits = (columns: WorkspaceColumn[]) =>
    widthOf(anchor, columns) >= minimum;

  const contentOpen = open.content && anchor !== "content";
  const content: WorkspaceColumn[] = contentOpen
    ? [{ type: "pane", pane: "content", width: contentWidth(available) }]
    : [];
  const sides = SIDE_PANES.filter((pane) => open[pane] && pane !== anchor);
  const sideFront = sides.includes(front) ? front : sides[0];

  const layout = (
    columns: WorkspaceColumn[],
    overlay: WorkspaceOverlay | null,
    arrangement: Extract<WorkspaceLayout, { kind: "columns" }>["arrangement"],
  ): WorkspaceLayout => ({
    kind: "columns",
    breakpoint,
    rail,
    columns,
    overlay,
    arrangement,
  });

  // Nothing but the anchor.
  if (content.length === 0 && sides.length === 0) {
    return layout(place([], []), null, "single");
  }

  // 1. Every open pane its own column.
  const all = place(
    content,
    sides.map((pane) => ({ type: "pane", pane, width: SIDE_WIDTH })),
  );
  if (fits(all)) {
    return layout(all, null, "all");
  }

  // 2. Sketch and Chat as tabs in one column.
  const sideColumn: WorkspaceColumn[] =
    sides.length === 0 || sideFront === undefined
      ? []
      : sides.length === 1
        ? [{ type: "pane", pane: sides[0], width: SIDE_WIDTH }]
        : [{ type: "tabs", panes: sides, front: sideFront, width: SIDE_WIDTH }];
  if (sides.length === 2) {
    const tabbed = place(content, sideColumn);
    if (fits(tabbed)) {
      return layout(tabbed, null, "tabbed");
    }
  }

  // 3. The anchor and one column: the one used last. The other folds.
  const contentStrip: WorkspaceColumn[] = contentOpen
    ? [{ type: "strip", panes: ["content"], edge: "left", width: STRIP_WIDTH }]
    : [];
  const sideStrip: WorkspaceColumn[] =
    sides.length > 0
      ? [
          {
            type: "strip",
            panes: [...sides],
            edge: "right",
            width: STRIP_WIDTH,
          },
        ]
      : [];
  // Whether Sketch or Chat was used more recently than Content.
  const contentAt = recent.indexOf("content");
  const sideAt = recent.findIndex(
    (pane) => pane !== "content" && open[pane] && pane !== anchor,
  );
  const sideUsedLast =
    sides.length > 0 &&
    (!contentOpen || contentAt === -1 || (sideAt !== -1 && sideAt < contentAt));

  // With overlays, the side column keeps its place, and Content comes over
  // the preview while it is the one in use.
  if (
    narrow === "overlay" &&
    anchor === "preview" &&
    contentOpen &&
    sides.length > 0
  ) {
    const docked = place([], sideColumn);
    const folded = place(contentStrip, sideColumn);
    const [floating] = content;
    if (sideUsedLast || floating === undefined || floating.type !== "pane") {
      if (fits(folded)) {
        return layout(folded, null, "one-column");
      }
    } else if (fits(docked)) {
      return layout(
        docked,
        { edge: "left", width: floating.width, column: floating },
        "one-column",
      );
    }
  }

  const kept = sideUsedLast ? sideColumn : content;
  const pair = sideUsedLast
    ? place(contentStrip, kept)
    : place(kept, sideStrip);
  if (fits(pair)) {
    return layout(pair, null, "one-column");
  }

  // 4. Not even one column fits: the one in use is a sheet over the anchor.
  const [sheet] = kept;
  const columns = sideUsedLast ? place(contentStrip, []) : place([], sideStrip);
  if (sheet === undefined || sheet.type === "strip") {
    return layout(columns, null, "one-column");
  }
  return layout(
    columns,
    {
      edge: sideUsedLast ? "right" : "left",
      width: Math.min(sheet.width, available - STRIP_WIDTH - GAP),
      column: sheet,
    },
    "one-column",
  );
}
