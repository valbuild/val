import { EditorState } from "prosemirror-state";
import { toggleMark } from "prosemirror-commands";
import {
  buildSchema,
  parseEditorDocument,
  serializeEditorDocument,
} from "../../RichTextEditor";
import type { EditorDocument } from "../../RichTextEditor";
import {
  fromEditorSelection,
  toEditorSelection,
} from "./inlineSelectionMapping";

const schema = buildSchema({});
const document: EditorDocument = [
  { tag: "h2", children: ["Who we are"] },
  {
    tag: "p",
    children: [
      "We are ",
      { tag: "span", styles: ["bold"], children: ["forty"] },
      " people.",
      { tag: "br" },
      "Since 2012.",
    ],
  },
  {
    tag: "ul",
    children: [
      { tag: "li", children: [{ tag: "p", children: ["Oslo"] }] },
      { tag: "li", children: [{ tag: "p", children: ["Bergen"] }] },
    ],
  },
];
const doc = parseEditorDocument(document, schema);
const textIn = (selection: { from: number; to: number }) =>
  doc.textBetween(selection.from, selection.to);

describe("a selection on the page, in the Studio's editor", () => {
  test("a range inside a paragraph is that range, marks or not", () => {
    const selection = toEditorSelection(doc, {
      anchor: { block: 1, offset: 7 },
      head: { block: 1, offset: 12 },
    });
    expect(selection && textIn(selection)).toBe("forty");
  });

  test("a line break counts as one, as the page counts it", () => {
    const selection = toEditorSelection(doc, {
      anchor: { block: 1, offset: 21 },
      head: { block: 1, offset: 26 },
    });
    expect(selection && textIn(selection)).toBe("Since");
  });

  test("blocks are counted in the order they are read, list items included", () => {
    const selection = toEditorSelection(doc, {
      anchor: { block: 3, offset: 0 },
      head: { block: 3, offset: 6 },
    });
    expect(selection && textIn(selection)).toBe("Bergen");
  });

  test("an offset past the end of a block is its end", () => {
    const selection = toEditorSelection(doc, {
      anchor: { block: 0, offset: 4 },
      head: { block: 0, offset: 999 },
    });
    expect(selection && textIn(selection)).toBe("we are");
  });

  test("a block the document does not have is no selection at all", () => {
    expect(
      toEditorSelection(doc, {
        anchor: { block: 9, offset: 0 },
        head: { block: 9, offset: 0 },
      }),
    ).toBeNull();
    expect(toEditorSelection(doc, null)).toBeNull();
  });

  test("and back: the editor's selection, as the page names places", () => {
    const selection = {
      anchor: { block: 1, offset: 21 },
      head: { block: 3, offset: 2 },
    };
    const mapped = toEditorSelection(doc, selection);
    if (mapped === null) throw new Error("the selection did not map");
    const state = EditorState.create({ schema, doc, selection: mapped });
    expect(fromEditorSelection(state)).toEqual(selection);
  });

  test("a control acts on exactly what the page selected", () => {
    // "people", made italic: what a press on Italic does.
    const mapped = toEditorSelection(doc, {
      anchor: { block: 1, offset: 13 },
      head: { block: 1, offset: 19 },
    });
    if (mapped === null) throw new Error("the selection did not map");
    let state = EditorState.create({ schema, doc, selection: mapped });
    toggleMark(schema.marks.italic)(state, (transaction) => {
      state = state.apply(transaction);
    });
    expect(serializeEditorDocument(state.doc)[1]).toEqual({
      tag: "p",
      children: [
        "We are ",
        { tag: "span", styles: ["bold"], children: ["forty"] },
        " ",
        { tag: "span", styles: ["italic"], children: ["people"] },
        ".",
        { tag: "br" },
        "Since 2012.",
      ],
    });
    // And what was selected still is, in the page's terms.
    expect(fromEditorSelection(state)).toEqual({
      anchor: { block: 1, offset: 13 },
      head: { block: 1, offset: 19 },
    });
  });
});
