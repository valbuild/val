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
    for (const error of globalTransientErrors) {
      if (shownIds.current.has(error.id)) {
        continue;
      }
      shownIds.current.add(error.id);
      toast.error(error.message, {
        id: error.id,
        description: error.details,
        duration: TOAST_DURATION,
      });
    }
  }, [globalTransientErrors]);

  return null;
}
