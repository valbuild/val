import {
  inputRules,
  wrappingInputRule,
  textblockTypeInputRule,
  InputRule,
} from "prosemirror-inputrules";
import type { MarkType, Schema } from "prosemirror-model";
import type { Plugin } from "prosemirror-state";

function markingInputRule(regex: RegExp, markType: MarkType): InputRule {
  return new InputRule(regex, (state, match, start, end) => {
    const captured = match[1];
    if (!captured) return null;
    const tr = state.tr;
    const startReplace = start;
    const endReplace = end;
    tr.replaceWith(
      startReplace,
      endReplace,
      state.schema.text(captured, [markType.create()]),
    );
    tr.removeStoredMark(markType);
    return tr;
  });
}

export function buildChatInputRules(schema: Schema): Plugin {
  const rules: InputRule[] = [];

  rules.push(
    textblockTypeInputRule(/^(#{1,3})\s$/, schema.nodes.heading, (match) => ({
      level: match[1].length,
    })),
  );

  rules.push(wrappingInputRule(/^\s*>\s$/, schema.nodes.blockquote));
  rules.push(wrappingInputRule(/^\s*([-+*])\s$/, schema.nodes.bullet_list));
  rules.push(
    wrappingInputRule(
      /^(\d+)\.\s$/,
      schema.nodes.ordered_list,
      (match) => ({ order: +match[1] }),
      (match, node) => node.childCount + node.attrs.order === +match[1],
    ),
  );

  rules.push(markingInputRule(/\*\*([^*]+)\*\*$/, schema.marks.bold));
  rules.push(markingInputRule(/(?:^|[^*])\*([^*]+)\*$/, schema.marks.italic));
  rules.push(markingInputRule(/~~([^~]+)~~$/, schema.marks.strikethrough));
  rules.push(markingInputRule(/`([^`]+)`$/, schema.marks.code));

  return inputRules({ rules });
}
