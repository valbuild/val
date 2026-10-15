import { useEffect, useRef } from "react";
import type { TransientError } from "../stores/StatusStore";
import { useGlobalTransientErrors } from "./ValProvider";
import { toast } from "./designSystem/sonner";

const TOAST_DURATION = 6000;

/**
 * Bridges the transient-error queue to sonner toasts: every new error pops up
 * as a toast that auto-dismisses. The error stays in the queue (the history)
 * so it remains visible in the transient-errors list — dismissing a toast here
 * never removes it from the queue.
 */
export function TransientErrorToasts({
  actionFor,
}: {
  /**
   * The next step for an error, as a button on its toast: the shell offers
   * Billing (or the owners) for a write Val Build refused for the plan, whose
   * raw message is all the error carries. Read when the toast is shown.
   */
  actionFor?: (
    error: TransientError,
  ) => { label: string; onClick: () => void } | undefined;
} = {}) {
  const { globalTransientErrors } = useGlobalTransientErrors();
  const shownIds = useRef<Set<string>>(new Set());
  const actionForRef = useRef(actionFor);
  actionForRef.current = actionFor;

  useEffect(() => {
    const currentIds = new Set<string>();
    for (const error of globalTransientErrors) {
      currentIds.add(error.id);
      if (shownIds.current.has(error.id)) {
        continue;
      }
      const action = actionForRef.current?.(error);
      toast.error(error.message, {
        id: error.id,
        description: error.details,
        duration: TOAST_DURATION,
        ...(action !== undefined ? { action } : {}),
      });
    }
    // Prune ids that are no longer in the (bounded) queue so this set stays
    // bounded to the queue size and does not leak over a long session.
    shownIds.current = currentIds;
  }, [globalTransientErrors]);

  return null;
}
