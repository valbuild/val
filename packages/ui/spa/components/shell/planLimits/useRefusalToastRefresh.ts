import { useEffect, useRef } from "react";
import { isRefusalText } from "./planCopy";
import type { StudioAccessState } from "./useStudioAccess";

/**
 * Ask Val Build again when an error the Studio reports is a refusal from it.
 *
 * A refusal that reaches the Studio as data (`reportPlanRefusal`: a save's
 * `plan-refused` 403, a publish, an upload) asks by itself. This is for one
 * that arrives as Val Build's sentence alone -- through an app whose
 * `@valbuild/server` predates `plan-refused` -- which names the
 * organization's Billing ({@link isRefusalText}): then `/access` says what is
 * true now. A network blip is no reason to ask -- on Free, `/access` takes
 * Val Build's change-count lock -- except where the answer names no Billing
 * link to tell a refusal by (an older Val Build): then any new error asks,
 * as it always did.
 *
 * Only an error that is NEW: the ones already there when this mounts, and
 * any seen before (a dismissal changes the list, not the errors), are not
 * asked about again. An error that arrives before `/access` has answered is
 * kept until it has, and judged then.
 */
export function useRefusalToastRefresh(
  errors: readonly { id: string; message: string; details?: string }[],
  state: Pick<StudioAccessState, "access" | "refresh">,
): void {
  const seen = useRef<Set<string> | null>(null);
  const { access, refresh } = state;
  useEffect(() => {
    if (seen.current === null) {
      seen.current = new Set(errors.map((error) => error.id));
      return;
    }
    if (access === null) return;
    const before = seen.current;
    let refused = false;
    for (const error of errors) {
      if (before.has(error.id)) continue;
      if (
        access.billingUrl === null ||
        isRefusalText(access, error.details) ||
        isRefusalText(access, error.message)
      ) {
        refused = true;
      }
    }
    // The errors still listed, and no others: the list is bounded, and this
    // stays as small as it.
    seen.current = new Set(errors.map((error) => error.id));
    if (refused) refresh();
  }, [errors, access, refresh]);
}
