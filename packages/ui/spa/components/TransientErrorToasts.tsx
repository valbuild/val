import { useEffect, useRef } from "react";
import { useGlobalTransientErrors } from "./ValProvider";
import { toast } from "./designSystem/sonner";

const TOAST_DURATION = 6000;

/**
 * Bridges the transient-error queue to sonner toasts: every new error pops up
 * as a toast that auto-dismisses. The error stays in the queue (the history)
 * so it remains visible in the transient-errors list — dismissing a toast here
 * never removes it from the queue.
 */
export function TransientErrorToasts() {
  const { globalTransientErrors } = useGlobalTransientErrors();
  const shownIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    const currentIds = new Set<string>();
    for (const error of globalTransientErrors) {
      currentIds.add(error.id);
      if (shownIds.current.has(error.id)) {
        continue;
      }
      toast.error(error.message, {
        id: error.id,
        description: error.details,
        duration: TOAST_DURATION,
      });
    }
    // Prune ids that are no longer in the (bounded) queue so this set stays
    // bounded to the queue size and does not leak over a long session.
    shownIds.current = currentIds;
  }, [globalTransientErrors]);

  return null;
}
