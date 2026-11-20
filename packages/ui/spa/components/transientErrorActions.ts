import type { TransientError } from "../stores/StatusStore";
import { showHeldEdits } from "./HeldEditsBanner";

/**
 * The button for an action a store named (`TransientErrorAction`): what a
 * toast offers beside its message when nothing more specific does.
 */
export function namedAction(
  action: TransientError["action"],
  /** What a button that needs the store calls; absent, it is not offered. */
  handlers: { retrySave?: () => void } = {},
): { label: string; onClick: () => void } | undefined {
  switch (action) {
    case "show-held-edits":
      return { label: "Show the edits", onClick: showHeldEdits };
    case "retry-save":
      return handlers.retrySave === undefined
        ? undefined
        : { label: "Save again", onClick: handlers.retrySave };
    case undefined:
      return undefined;
  }
}
