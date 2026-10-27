import { Plugin, PluginKey } from "prosemirror-state";
import type { Schema } from "prosemirror-model";

export const submitOnEnterKey = new PluginKey("submitOnEnter");

export function createSubmitOnEnterPlugin(
  schema: Schema,
  onSubmit: () => void,
): Plugin {
  return new Plugin({
    key: submitOnEnterKey,
    props: {
      handleKeyDown(view, event) {
        if (event.key !== "Enter") return false;

        // Cmd/Ctrl-Enter always submits.
        if (event.metaKey || event.ctrlKey) {
          event.preventDefault();
          onSubmit();
          return true;
        }

        // Shift-Enter → hard_break (handled by the keymap).
        if (event.shiftKey) return false;

        // Inside a list item, let splitListItem handle Enter.
        const { $from } = view.state.selection;
        for (let d = $from.depth; d > 0; d--) {
          const nodeType = $from.node(d).type;
          if (nodeType === schema.nodes.list_item) {
            return false;
          }
        }

        event.preventDefault();
        onSubmit();
        return true;
      },
    },
  });
}
