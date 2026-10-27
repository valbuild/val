import { keymap } from "prosemirror-keymap";
import {
  baseKeymap,
  toggleMark,
  setBlockType,
  wrapIn,
} from "prosemirror-commands";
import { undo, redo } from "prosemirror-history";
import {
  wrapInList,
  splitListItem,
  liftListItem,
  sinkListItem,
} from "prosemirror-schema-list";
import type { Schema } from "prosemirror-model";
import type {
  Command,
  Plugin,
  EditorState,
  Transaction,
} from "prosemirror-state";

export function buildChatKeymap(schema: Schema): Plugin[] {
  const keys: Record<string, Command> = {};

  keys["Mod-z"] = undo;
  keys["Mod-y"] = redo;
  keys["Mod-Shift-z"] = redo;

  keys["Mod-b"] = toggleMark(schema.marks.bold);
  keys["Mod-i"] = toggleMark(schema.marks.italic);
  keys["Mod-Shift-x"] = toggleMark(schema.marks.strikethrough);
  keys["Mod-e"] = toggleMark(schema.marks.code);

  const br = schema.nodes.hard_break;
  keys["Shift-Enter"] = (
    state: EditorState,
    dispatch?: (tr: Transaction) => void,
  ) => {
    if (dispatch) {
      dispatch(state.tr.replaceSelectionWith(br.create()).scrollIntoView());
    }
    return true;
  };

  for (let i = 1; i <= 3; i++) {
    keys[`Mod-Alt-${i}`] = setBlockType(schema.nodes.heading, { level: i });
  }
  keys["Mod-Alt-0"] = setBlockType(schema.nodes.paragraph);

  keys["Mod-Shift-b"] = wrapIn(schema.nodes.blockquote);
  keys["Mod-Shift-8"] = wrapInList(schema.nodes.bullet_list);
  keys["Mod-Shift-9"] = wrapInList(schema.nodes.ordered_list);

  keys["Enter"] = splitListItem(schema.nodes.list_item);
  keys["Mod-["] = liftListItem(schema.nodes.list_item);
  keys["Mod-]"] = sinkListItem(schema.nodes.list_item);

  return [keymap(keys), keymap(baseKeymap)];
}
