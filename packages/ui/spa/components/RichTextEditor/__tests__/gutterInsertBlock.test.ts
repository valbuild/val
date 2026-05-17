import { EditorState, TextSelection } from "prosemirror-state";
import type { Node as PMNode } from "prosemirror-model";
import { buildSchema } from "../schema";

const schema = buildSchema();

/**
 * Mirror of endOfBlock from gutterPlugin.ts — computes the absolute
 * position right after a top-level block at the given doc-content index.
 */
function endOfBlock(doc: PMNode, blockIndex: number): number {
  let pos = 0;
  for (let i = 0; i <= blockIndex; i++) {
    pos += doc.child(i).nodeSize;
  }
  return pos;
}

/**
 * Mirror of insertBlockAfter from gutterPlugin.ts — inserts a block
 * after the given top-level block index and moves selection into it.
 */
function insertBlockAfter(
  state: EditorState,
  blockIndex: number,
  block: PMNode,
): EditorState | null {
  const { doc } = state;
  if (blockIndex < 0 || blockIndex >= doc.childCount) return null;

  const insertPos = endOfBlock(doc, blockIndex);
  const tr = state.tr.insert(insertPos, block);
  tr.setSelection(TextSelection.near(tr.doc.resolve(insertPos + 1), 1));
  return state.apply(tr);
}

function docFromParagraphs(...texts: string[]) {
  return schema.nodes.doc.create(
    null,
    texts.map((t) =>
      schema.nodes.paragraph.create(null, t ? [schema.text(t)] : []),
    ),
  );
}

function stateFrom(doc: PMNode) {
  return EditorState.create({ doc, schema });
}

describe("gutterPlugin insertBlockAfter", () => {
  test("inserts a paragraph after the first block in a two-paragraph doc", () => {
    const doc = docFromParagraphs("Hello", "World");
    const state = stateFrom(doc);
    const newParagraph = schema.nodes.paragraph.create();

    const next = insertBlockAfter(state, 0, newParagraph);
    expect(next).not.toBeNull();

    const newDoc = next!.doc;
    expect(newDoc.childCount).toBe(3);
    expect(newDoc.child(0).textContent).toBe("Hello");
    expect(newDoc.child(1).textContent).toBe("");
    expect(newDoc.child(2).textContent).toBe("World");

    const { selection } = next!;
    expect(selection).toBeInstanceOf(TextSelection);
    const insertedBlockStart = 1 + newDoc.child(0).nodeSize;
    const insertedBlockEnd = insertedBlockStart + newDoc.child(1).nodeSize;
    expect(selection.from).toBeGreaterThanOrEqual(insertedBlockStart);
    expect(selection.from).toBeLessThan(insertedBlockEnd);
  });

  test("inserts a paragraph after the last block", () => {
    const doc = docFromParagraphs("Only");
    const state = stateFrom(doc);
    const newParagraph = schema.nodes.paragraph.create();

    const next = insertBlockAfter(state, 0, newParagraph);
    expect(next).not.toBeNull();

    const newDoc = next!.doc;
    expect(newDoc.childCount).toBe(2);
    expect(newDoc.child(0).textContent).toBe("Only");
    expect(newDoc.child(1).textContent).toBe("");
  });

  test("inserts a heading after a block", () => {
    const doc = docFromParagraphs("Before");
    const state = stateFrom(doc);
    const heading = schema.nodes.heading.create({ level: 1 });

    const next = insertBlockAfter(state, 0, heading);
    expect(next).not.toBeNull();

    const newDoc = next!.doc;
    expect(newDoc.childCount).toBe(2);
    expect(newDoc.child(1).type.name).toBe("heading");
    expect(newDoc.child(1).attrs.level).toBe(1);
  });

  test("inserts between blocks in a three-paragraph doc", () => {
    const doc = docFromParagraphs("A", "B", "C");
    const state = stateFrom(doc);
    const newParagraph = schema.nodes.paragraph.create(
      null,
      schema.text("inserted"),
    );

    const next = insertBlockAfter(state, 1, newParagraph);
    expect(next).not.toBeNull();

    const newDoc = next!.doc;
    expect(newDoc.childCount).toBe(4);
    expect(newDoc.child(0).textContent).toBe("A");
    expect(newDoc.child(1).textContent).toBe("B");
    expect(newDoc.child(2).textContent).toBe("inserted");
    expect(newDoc.child(3).textContent).toBe("C");
  });

  test("returns null for out-of-bounds blockIndex", () => {
    const doc = docFromParagraphs("Solo");
    const state = stateFrom(doc);
    const newParagraph = schema.nodes.paragraph.create();

    expect(insertBlockAfter(state, -1, newParagraph)).toBeNull();
    expect(insertBlockAfter(state, 1, newParagraph)).toBeNull();
    expect(insertBlockAfter(state, 99, newParagraph)).toBeNull();
  });
});
