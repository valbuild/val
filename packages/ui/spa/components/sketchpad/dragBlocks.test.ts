import { EditorState, NodeSelection } from "prosemirror-state";
import { moveBlock } from "./dragBlocks";
import { docFromSketch, sketchFromDoc } from "./sketchpadDoc";

/**
 * Moving a block by its grip, as a finger does on a phone (`moveBlock`):
 * the same move a mouse's drop makes, and nothing when let go where it
 * already was.
 */
function stateOf(sketch: string) {
  const { doc, icons } = docFromSketch(sketch);
  return { state: EditorState.create({ doc }), icons };
}

/** The position of the top-level block at `index`. */
function blockAt(state: EditorState, index: number): number {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += state.doc.child(i).nodeSize;
  return pos;
}

describe("moving a block by its grip", () => {
  test("moves a paragraph below another, as a drop does", () => {
    const { state, icons } = stateOf("First\nSecond\nThird\n");
    const from = blockAt(state, 0);
    // Let go just after the third block.
    const tr = moveBlock(state, from, state.doc.content.size);
    expect(tr).not.toBeNull();
    const next = state.apply(tr!);
    expect(sketchFromDoc(next.doc, icons)).toBe("Second\nThird\nFirst\n");
    // And it stays selected where it landed, so it is plain what moved.
    expect(next.selection).toBeInstanceOf(NodeSelection);
  });

  test("moves a box above the text before it", () => {
    const { state, icons } = stateOf("Intro\n[hero: The coat]\n");
    const tr = moveBlock(state, blockAt(state, 1), 0);
    expect(tr).not.toBeNull();
    expect(sketchFromDoc(state.apply(tr!).doc, icons)).toBe(
      "[hero: The coat]\nIntro\n",
    );
  });

  test("let go where it already was, nothing changes", () => {
    const { state } = stateOf("First\nSecond\n");
    expect(moveBlock(state, blockAt(state, 0), 0)).toBeNull();
  });
});
