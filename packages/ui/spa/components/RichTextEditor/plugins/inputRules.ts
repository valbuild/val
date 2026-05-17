import {
  inputRules,
  wrappingInputRule,
  textblockTypeInputRule,
  InputRule,
} from "prosemirror-inputrules";
import type { Schema } from "prosemirror-model";
import type { Plugin } from "prosemirror-state";
import {
  type ResolvedEditorFeatures,
  HEADING_FEATURE_KEYS,
  isAnyHeadingEnabled,
} from "../types";

export function buildInputRules(
  schema: Schema,
  features?: ResolvedEditorFeatures,
): Plugin {
  const rules: InputRule[] = [];

  if (schema.nodes.heading && (!features || isAnyHeadingEnabled(features))) {
    rules.push(
      textblockTypeInputRule(/^(#{1,6})\s$/, schema.nodes.heading, (match) => {
        const level = match[1].length;
        if (features && !features[HEADING_FEATURE_KEYS[level - 1]])
          return false;
        return { level };
      }),
    );
  }

  if (schema.nodes.blockquote && (!features || features.blockquote)) {
    rules.push(wrappingInputRule(/^\s*>\s$/, schema.nodes.blockquote));
  }

  if (schema.nodes.bullet_list && (!features || features.bulletList)) {
    rules.push(wrappingInputRule(/^\s*([-+*])\s$/, schema.nodes.bullet_list));
  }

  if (schema.nodes.ordered_list && (!features || features.orderedList)) {
    rules.push(
      wrappingInputRule(
        /^(\d+)\.\s$/,
        schema.nodes.ordered_list,
        (match) => ({
          order: +match[1],
        }),
        (match, node) => node.childCount + node.attrs.order === +match[1],
      ),
    );
  }

  if (schema.nodes.code_block && (!features || features.codeBlock)) {
    rules.push(textblockTypeInputRule(/^```$/, schema.nodes.code_block));
  }

  return inputRules({ rules });
}
