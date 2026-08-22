import { EditorState, type Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { buildChatSchema } from "../schema/buildChatSchema";
import { buildChatInputRules } from "../plugins/inputRules";

const schema = buildChatSchema();
const plugin = buildChatInputRules(schema);

/**
 * Drive the input-rules plugin the way the editor does, without a DOM.
 *
 * `inputRules()` hides its rule list inside `handleTextInput`, so the only way
 * to exercise a rule is through that prop. It reads `composing`, `state` and
 * `dispatch` off the view and nothing else, so a stub is enough.
 */
function typeAtEnd(
  text: string,
  typed: string,
): { text: string; marks: string[][] } {
  const state = EditorState.create({
    schema,
    doc: schema.node("doc", null, [
      schema.node("paragraph", null, text ? [schema.text(text)] : []),
    ]),
    plugins: [plugin],
  });
  const pos = state.doc.content.size - 1;
  let dispatched: Transaction | null = null;
  const view = {
    composing: false,
    state,
    dispatch: (tr: Transaction) => {
      dispatched = tr;
    },
  };
  const handled = plugin.props.handleTextInput?.call(
    plugin,
    // The plugin only touches the three fields stubbed above.
    view as unknown as EditorView,
    pos,
    pos,
    typed,
    // `deflt` is only called for rules built with a string handler; ours are all
    // functions, so it is never reached.
    () => {
      throw new Error("unexpected default transaction");
    },
  );
  if (!handled || !dispatched) {
    return { text: text + typed, marks: [] };
  }
  const doc = (dispatched as Transaction).doc;
  const paragraph = doc.child(0);
  const marks: string[][] = [];
  paragraph.forEach((child) => {
    marks.push(child.marks.map((m) => m.type.name));
  });
  return { text: paragraph.textContent, marks };
}

describe("chat input rules", () => {
  // The italic rule has to match the character in front of the opening `*` so
  // that the inner `*bold*` of `**bold**` does not trigger it. The rule used to
  // replace its WHOLE match, which deleted that character: typing `a*b*` left
  // just an italic `b`.
  it("italic keeps the character before the opening asterisk", () => {
    expect(typeAtEnd("a*b", "*")).toEqual({
      text: "ab",
      marks: [[], ["italic"]],
    });
  });

  it("italic at the start of a block needs no preceding character", () => {
    expect(typeAtEnd("*b", "*")).toEqual({ text: "b", marks: [["italic"]] });
  });

  it("italic keeps a whole preceding word", () => {
    expect(typeAtEnd("hello *world", "*")).toEqual({
      text: "hello world",
      marks: [[], ["italic"]],
    });
  });

  it("bold wins over italic on the closing asterisks", () => {
    expect(typeAtEnd("**b*", "*")).toEqual({ text: "b", marks: [["bold"]] });
  });

  it("strikethrough and code mark only their delimited text", () => {
    expect(typeAtEnd("a~~b~", "~")).toEqual({
      text: "ab",
      marks: [[], ["strikethrough"]],
    });
    expect(typeAtEnd("a`b", "`")).toEqual({
      text: "ab",
      marks: [[], ["code"]],
    });
  });
});
