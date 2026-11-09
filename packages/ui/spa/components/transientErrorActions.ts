import type { TransientError } from "../stores/StatusStore";
import { showHeldEdits } from "./HeldEditsBanner";

/**
 * The button for an action a store named (`TransientErrorAction`): what a
 * toast offers beside its message when nothing more specific does.
 */
export function namedAction(
  action: TransientError["action"],
): { label: string; onClick: () => void } | undefined {
  switch (action) {
    case "show-held-edits":
      return { label: "Show the edits", onClick: showHeldEdits };
    case undefined:
      return undefined;
  }
}
