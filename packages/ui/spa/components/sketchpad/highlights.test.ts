import { EditorState } from "prosemirror-state";
import { highlights, highlightsKey } from "./highlights";
import { docFromSketch, sketchSchema } from "./sketchpadDoc";

describe("a highlight", () => {
  test("stays on its block when a line is added above it", () => {
    let state = EditorState.create({
      doc: docFromSketch("# A\nB\nC\n").doc,
      plugins: [highlights()],
    });
    state = state.apply(
      state.tr.setMeta(highlightsKey, [
        { id: "h", lines: [3], color: "red", note: "this one" },
      ]),
    );
    state = state.apply(
      state.tr.insert(
        0,
        sketchSchema.nodes.paragraph.create(null, sketchSchema.text("New")),
      ),
    );
    const pos = highlightsKey.getState(state)?.positions.get("h")?.[0];
    expect(pos === undefined ? null : state.doc.nodeAt(pos)?.textContent).toBe(
      "C",
    );
  });
});
