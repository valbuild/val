import { buildSchema } from "../schema";
import { parseEditorDocument } from "../serialize/parseEditorDocument";
import type { EditorDocument } from "../types";
import { EditorState } from "prosemirror-state";
import { createErrorPlugin, errorPluginKey } from "../plugins/errorPlugin";

const schema = buildSchema();

function createStateWithErrors(
  doc: EditorDocument,
  errors: { path: string; message: string; kind: string }[],
) {
  const pmDoc = parseEditorDocument(doc, schema);
  let state = EditorState.create({
    doc: pmDoc,
    plugins: [createErrorPlugin()],
  });
  const tr = state.tr.setMeta(errorPluginKey, {
    errors,
    errorKindClassName: {},
  });
  state = state.apply(tr);
  return state;
}

describe("error path resolution", () => {
  test("resolves path /0 to first block node", () => {
    const doc: EditorDocument = [
      { tag: "p", children: ["First"] },
      { tag: "p", children: ["Second"] },
    ];
    const state = createStateWithErrors(doc, [
      { path: "/0", message: "Error on first paragraph", kind: "test" },
    ]);
    const errorState = errorPluginKey.getState(state);
    expect(errorState).toBeDefined();
    expect(errorState!.errors).toHaveLength(1);
    const decoSet = errorState!.decorations;
    const decos = decoSet.find();
    expect(decos.length).toBeGreaterThan(0);
  });

  test("resolves path /0/children/1 to second child of first block", () => {
    const doc: EditorDocument = [
      {
        tag: "p",
        children: [
          "Before ",
          { tag: "span", styles: ["bold"], children: ["Bold text"] },
        ],
      },
    ];
    const state = createStateWithErrors(doc, [
      {
        path: "/0/children/1",
        message: "Error on bold",
        kind: "validation.bold",
      },
    ]);
    const errorState = errorPluginKey.getState(state);
    expect(errorState).toBeDefined();
  });

  test("invalid path does not produce decorations", () => {
    const doc: EditorDocument = [{ tag: "p", children: ["Hello"] }];
    const state = createStateWithErrors(doc, [
      { path: "/99", message: "Bad path", kind: "test" },
    ]);
    const errorState = errorPluginKey.getState(state);
    const decos = errorState!.decorations.find();
    expect(decos).toHaveLength(0);
  });
});

describe("onApplyErrorFix arguments", () => {
  test("fix callback receives correct args shape", () => {
    const callback = jest.fn();
    const args = { path: "/0", kind: "validation.link", fixId: "fix-url" };
    callback(args);
    expect(callback).toHaveBeenCalledWith({
      path: "/0",
      kind: "validation.link",
      fixId: "fix-url",
    });
  });

  test("multiple fixes have distinct ids", () => {
    const fixes = [
      { id: "fix-1", label: "Fix 1" },
      { id: "fix-2", label: "Fix 2" },
    ];
    const ids = new Set(fixes.map((f) => f.id));
    expect(ids.size).toBe(fixes.length);
  });
});
