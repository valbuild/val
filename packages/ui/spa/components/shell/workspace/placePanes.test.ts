import { placePanes } from "./placePanes";
import {
  GAP,
  RESIZE_MAX,
  RESIZE_MIN,
  SIDE_WIDTH,
  STRIP_WIDTH,
  workspaceLayout,
  type WorkspaceLayoutInput,
} from "./workspaceLayout";

const everythingOpen: WorkspaceLayoutInput = {
  width: 1600,
  open: { content: true, preview: true, sketch: true, chat: true },
  recent: ["content", "chat", "sketch"],
  front: "chat",
  narrow: "strips",
  phonePane: "preview",
};

function placed(input: Partial<WorkspaceLayoutInput>) {
  const merged = { ...everythingOpen, ...input };
  const layout = workspaceLayout(merged);
  if (layout.kind === "phone") throw new Error("a phone has no columns");
  return placePanes(layout, merged.open);
}

describe("placePanes", () => {
  test("a very wide screen: Sketch and the Assistant each a column, the Assistant at the edge", () => {
    const panes = placed({ width: 2560 });
    expect(panes.content.kind).toBe("column");
    expect(panes.chat).toEqual({
      right: 0,
      width: SIDE_WIDTH,
      tabs: null,
      sheet: false,
    });
    expect(panes.sketch).toEqual({
      right: SIDE_WIDTH + GAP,
      width: SIDE_WIDTH,
      tabs: null,
      sheet: false,
    });
    expect(panes.rightWidth).toBe(2 * (SIDE_WIDTH + GAP));
  });

  test("as tabs, only the one in front is placed, and it knows both tabs", () => {
    const panes = placed({ width: 1600, front: "sketch" });
    expect(panes.sketch).toMatchObject({ right: 0, tabs: ["sketch", "chat"] });
    expect(panes.chat).toBeNull();
    expect(panes.rightWidth).toBe(SIDE_WIDTH + GAP);
  });

  test("one column fits: what was used last keeps it, the other is a strip", () => {
    const sideLast = placed({ width: 1366, recent: ["chat", "content"] });
    expect(sideLast.content.kind).toBe("strip");
    expect(sideLast.chat).toMatchObject({ right: 0, sheet: false });

    const contentLast = placed({ width: 1366 });
    expect(contentLast.content.kind).toBe("column");
    expect(contentLast.chat).toBeNull();
    expect(contentLast.strips).toEqual([
      { right: 0, width: STRIP_WIDTH, panes: ["sketch", "chat"] },
    ]);
    expect(contentLast.rightWidth).toBe(STRIP_WIDTH + GAP);
  });

  test("a tablet: the side pane in use is a sheet over the preview", () => {
    const panes = placed({ width: 1024, recent: ["chat", "content"] });
    expect(panes.chat).toMatchObject({ right: 0, sheet: true });
  });

  test("with the preview closed, Content is in the middle", () => {
    const panes = placed({
      open: { content: true, preview: false, sketch: false, chat: true },
    });
    expect(panes.content).toEqual({ kind: "anchor" });
    expect(panes.chat).toMatchObject({ right: 0, sheet: false });
  });

  test("Content and the preview alone take the whole width", () => {
    const panes = placed({
      open: { content: true, preview: true, sketch: false, chat: false },
    });
    expect(panes.rightWidth).toBe(0);
    expect(panes.sketch).toBeNull();
    expect(panes.chat).toBeNull();
  });

  test("Content switched off: hidden, and the preview is in the middle", () => {
    const panes = placed({
      open: { content: false, preview: true, sketch: false, chat: true },
    });
    expect(panes.content).toEqual({ kind: "hidden" });
    expect(panes.chat).toMatchObject({ right: 0, sheet: false });
  });

  test("Content and the preview off: Sketch in the middle, the Assistant beside it", () => {
    const panes = placed({
      width: 1920,
      open: { content: false, preview: false, sketch: true, chat: true },
    });
    expect(panes.content).toEqual({ kind: "hidden" });
    expect(panes.chat).toMatchObject({ right: 0, width: SIDE_WIDTH });
    expect(panes.sketch?.right).toBe(SIDE_WIDTH + GAP);
    // The middle takes the rest of the width.
    expect(panes.sketch?.width).toBeGreaterThan(SIDE_WIDTH);
  });
});

/**
 * Columns dragged to a width (`ColumnDivider`): the layout uses the width
 * chosen, the preview takes what is left, and `slack` says how much further
 * any one column can go before the preview is at its minimum.
 */
describe("chosen widths", () => {
  test("Content and the Assistant at the widths they were dragged to", () => {
    const panes = placed({
      width: 2560,
      widths: { content: 600, chat: 520 },
    });
    expect(panes.content).toEqual({ kind: "column", width: 600 });
    expect(panes.chat?.width).toBe(520);
    expect(panes.sketch?.width).toBe(SIDE_WIDTH);
  });

  test("a width past what a column can be is held at the limit", () => {
    const panes = placed({ width: 2560, widths: { chat: 10, sketch: 5000 } });
    expect(panes.chat?.width).toBe(RESIZE_MIN.chat);
    expect(panes.sketch?.width).toBe(RESIZE_MAX);
  });

  test("a column shared as tabs is as wide as the pane in front", () => {
    const panes = placed({ width: 1600, widths: { chat: 500, sketch: 360 } });
    expect(panes.chat?.tabs).toEqual(["sketch", "chat"]);
    expect(panes.chat?.width).toBe(500);
  });

  test("dragging a column by its slack leaves the preview at its minimum, and the arrangement as it was", () => {
    const before = placed({ width: 1600 });
    const content =
      before.content.kind === "column" ? before.content.width : NaN;
    const after = placed({
      width: 1600,
      widths: { content: content + before.slack },
    });
    expect(after.content.kind).toBe("column");
    expect(after.chat?.tabs).toEqual(["sketch", "chat"]);
    expect(after.slack).toBe(0);
  });
});
