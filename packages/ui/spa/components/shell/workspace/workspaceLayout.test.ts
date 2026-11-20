import {
  PREVIEW_MIN,
  workspaceLayout,
  type WorkspaceColumn,
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

/** The columns as a short string: `content|preview|tabs(sketch,chat)`. */
function shape(input: Partial<WorkspaceLayoutInput>): string {
  const layout = workspaceLayout({ ...everythingOpen, ...input });
  if (layout.kind === "phone") return `phone:${layout.pane}`;
  const column = (each: WorkspaceColumn): string =>
    each.type === "pane"
      ? each.pane
      : each.type === "tabs"
        ? `tabs(${each.panes.join(",")})`
        : `strip(${each.panes.join(",")})`;
  const overlay =
    layout.overlay === null
      ? ""
      : ` + ${layout.overlay.edge} sheet ${column(layout.overlay.column)}`;
  return layout.columns.map(column).join("|") + overlay;
}

describe("workspaceLayout", () => {
  test("a very wide screen has a column for every pane", () => {
    expect(shape({ width: 2560 })).toBe("content|preview|sketch|chat");
  });

  test("Sketch and Chat share a column before anything folds", () => {
    expect(shape({ width: 1600 })).toBe("content|preview|tabs(sketch,chat)");
  });

  test("at laptop width, what was used last keeps its column", () => {
    expect(shape({ width: 1366 })).toBe("content|preview|strip(sketch,chat)");
    expect(shape({ width: 1366, recent: ["chat", "content"] })).toBe(
      "strip(content)|preview|tabs(sketch,chat)",
    );
  });

  test("with overlays, Content comes over the preview and the chat stays", () => {
    expect(shape({ width: 1366, narrow: "overlay" })).toBe(
      "preview|tabs(sketch,chat) + left sheet content",
    );
    expect(
      shape({ width: 1366, narrow: "overlay", recent: ["sketch", "content"] }),
    ).toBe("strip(content)|preview|tabs(sketch,chat)");
  });

  test("on a tablet, a chat that does not fit beside the preview is a sheet", () => {
    expect(shape({ width: 1024, recent: ["chat", "content"] })).toBe(
      "strip(content)|preview + right sheet tabs(sketch,chat)",
    );
    expect(shape({ width: 1024 })).toBe("content|preview|strip(sketch,chat)");
  });

  test("a phone shows one pane", () => {
    expect(shape({ width: 390, phonePane: "chat" })).toBe("phone:chat");
    expect(
      shape({
        width: 390,
        phonePane: "sketch",
        open: { content: true, preview: true, sketch: false, chat: true },
      }),
    ).toBe("phone:preview");
  });

  test("with the preview closed, Content is in the middle and as wide as there is room", () => {
    const closed = { content: true, preview: false, sketch: true, chat: true };
    expect(shape({ width: 1920, open: closed })).toBe("content|sketch|chat");
    expect(shape({ width: 1366, open: closed })).toBe(
      "content|tabs(sketch,chat)",
    );
    expect(
      shape({
        width: 1366,
        open: { content: false, preview: false, sketch: true, chat: true },
      }),
    ).toBe("sketch|chat");
  });

  test("a phone always has the preview, open or not", () => {
    expect(
      shape({
        width: 390,
        phonePane: "preview",
        open: { content: true, preview: false, sketch: false, chat: false },
      }),
    ).toBe("phone:preview");
  });

  test("the preview never gets narrower than its minimum, from a tablet up", () => {
    for (let width = 768; width <= 2800; width += 16) {
      for (const recent of [["content"], ["chat"]] as const) {
        for (const narrow of ["strips", "overlay"] as const) {
          const layout = workspaceLayout({
            ...everythingOpen,
            width,
            recent,
            narrow,
          });
          if (layout.kind !== "columns") throw new Error("not columns");
          const preview = layout.columns.find(
            (each) => each.type === "pane" && each.pane === "preview",
          );
          expect(preview?.width).toBeGreaterThanOrEqual(PREVIEW_MIN);
        }
      }
    }
  });
});
