import {
  inputRules,
  wrappingInputRule,
  textblockTypeInputRule,
  InputRule,
} from "prosemirror-inputrules";
import type { MarkType, Schema } from "prosemirror-model";
import type { Plugin } from "prosemirror-state";

/**
 * Turns `*text*`-style markup into a mark as it is typed.
 *
 * `regex` must capture the text to mark in group 1 and be delimited by
 * `delimiter` on both sides. It MAY also match characters in front of the
 * opening delimiter that are not part of the markup - the italic rule has to
 * look at the character before the `*` so that the inner `*bold*` of `**bold**`
 * does not trigger it. Those characters have to survive, so the replacement
 * starts past them instead of at the start of the match, which would delete
 * them.
 *
 * The offset is measured forward from `start` rather than back from `end`
 * because the closing delimiter the user just typed is not in the document yet:
 * `end` is the end of the text that precedes it.
 */
function markingInputRule(
  regex: RegExp,
  delimiter: string,
  markType: MarkType,
): InputRule {
  return new InputRule(regex, (state, match, start, end) => {
    const captured = match[1];
    if (!captured) return null;
    const prefixLength =
      match[0].length - (delimiter.length * 2 + captured.length);
    if (prefixLength < 0) return null;
    const tr = state.tr;
    tr.replaceWith(
      start + prefixLength,
      end,
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

  rules.push(markingInputRule(/\*\*([^*]+)\*\*$/, "**", schema.marks.bold));
  // The leading `[^*]` keeps this from firing on the inner `*bold*` of
  // `**bold**`; markingInputRule preserves whatever it matches.
  rules.push(
    markingInputRule(/(?:^|[^*])\*([^*]+)\*$/, "*", schema.marks.italic),
  );
  rules.push(
    markingInputRule(/~~([^~]+)~~$/, "~~", schema.marks.strikethrough),
  );
  rules.push(markingInputRule(/`([^`]+)`$/, "`", schema.marks.code));

  return inputRules({ rules });
}
