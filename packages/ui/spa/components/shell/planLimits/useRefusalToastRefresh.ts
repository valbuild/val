import { useEffect, useRef } from "react";
import { isRefusalText } from "./planCopy";
import type { StudioAccessState } from "./useStudioAccess";

/**
 * Ask Val Build again when an error the Studio reports is a refusal from it.
 *
 * A refusal that reaches the Studio as data (`reportPlanRefusal`: a save's
 * `plan-refused` 403, a publish, an upload) asks by itself. This is for one
 * that arrives as Val Build's sentence alone -- through an app whose
 * `@valbuild/server` predates `plan-refused`, which keeps the words and not
 * the code. Every one of those sentences names the organization's Billing
 * (or the project's page), so an error that does is a refusal, and `/access`
 * says what is true now. Nothing
 * else asks: on Free, `/access` takes Val Build's change-count lock, and a
 * network blip is no reason to.
 *
 * Only an error that is NEW: the ones already there when this mounts, and
 * any seen before (a dismissal changes the list, not the errors), are not
 * asked about again. And not before `/access` has answered once, since it
 * is that answer's links that tell a refusal apart.
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
    let refused = false;
    for (const error of errors) {
      if (seen.current.has(error.id)) continue;
      seen.current.add(error.id);
      if (
        isRefusalText(access, error.details) ||
        isRefusalText(access, error.message)
      ) {
        refused = true;
      }
    }
    if (refused) refresh();
  }, [errors, access, refresh]);
}
