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
import {
  type ResolvedEditorFeatures,
  HEADING_FEATURE_KEYS,
  isAnyHeadingEnabled,
} from "../types";

export function buildKeymap(
  schema: Schema,
  features?: ResolvedEditorFeatures,
): Plugin[] {
  const keys: Record<string, Command> = {};

  keys["Mod-z"] = undo;
  keys["Mod-y"] = redo;
  keys["Mod-Shift-z"] = redo;

  if (schema.marks.bold && (!features || features.bold)) {
    keys["Mod-b"] = toggleMark(schema.marks.bold);
  }
  if (schema.marks.italic && (!features || features.italic)) {
    keys["Mod-i"] = toggleMark(schema.marks.italic);
  }
  if (schema.marks.strikethrough && (!features || features.strikethrough)) {
    keys["Mod-Shift-x"] = toggleMark(schema.marks.strikethrough);
  }
  if (schema.marks.code && (!features || features.code)) {
    keys["Mod-e"] = toggleMark(schema.marks.code);
  }

  if (schema.nodes.hard_break && (!features || features.hardBreak)) {
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
  }

  if (schema.nodes.heading) {
    for (let i = 1; i <= 6; i++) {
      if (!features || features[HEADING_FEATURE_KEYS[i - 1]]) {
        keys[`Mod-Alt-${i}`] = setBlockType(schema.nodes.heading, { level: i });
      }
    }
    if (!features || isAnyHeadingEnabled(features)) {
      keys["Mod-Alt-0"] = setBlockType(schema.nodes.paragraph);
    }
  }

  if (schema.nodes.blockquote && (!features || features.blockquote)) {
    keys["Mod-Shift-b"] = wrapIn(schema.nodes.blockquote);
  }

  if (schema.nodes.code_block && (!features || features.codeBlock)) {
    keys["Mod-Alt-c"] = setBlockType(schema.nodes.code_block);
  }

  if (schema.nodes.bullet_list && (!features || features.bulletList)) {
    keys["Mod-Shift-8"] = wrapInList(schema.nodes.bullet_list);
  }
  if (schema.nodes.ordered_list && (!features || features.orderedList)) {
    keys["Mod-Shift-9"] = wrapInList(schema.nodes.ordered_list);
  }

  if (
    schema.nodes.list_item &&
    (!features || features.bulletList || features.orderedList)
  ) {
    keys["Enter"] = splitListItem(schema.nodes.list_item);
    keys["Mod-["] = liftListItem(schema.nodes.list_item);
    keys["Mod-]"] = sinkListItem(schema.nodes.list_item);
  }

  return [keymap(keys), keymap(baseKeymap)];
}
