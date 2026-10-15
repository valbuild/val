import { useEffect, useRef } from "react";
import { useValSystem } from "../../../stores/react/SystemContext";
import { editRefused, type StudioAccess } from "./studioAccess";

/**
 * Whether Val Build says this project's edits can be saved now. False while
 * it has not said (no answer, or no organization half in it): then the sync's
 * own timed retry is what sends them.
 */
export function editAllowed(access: StudioAccess | null): boolean {
  return access !== null && access.plan !== null && !editRefused(access);
}

/**
 * Send the edits a plan refusal held back as soon as Val Build says editing
 * has become allowed -- an owner added a card, or the Free week moved on --
 * rather than when the sync's timed retry comes round.
 *
 * On the CHANGE to allowed, not on every answer that allows it: a save
 * refused while `/access` (asked a moment earlier, or racing the limit) still
 * says yes would otherwise resume, be refused, ask again, and resume again,
 * every couple of seconds. That case is left to the timed retry.
 */
export function useResumeRefusedSaves(access: StudioAccess | null): void {
  const val = useValSystem();
  // Null until Val Build answers: the first answer is not a change.
  const allowed = access === null ? null : editAllowed(access);
  const wasAllowed = useRef<boolean | null>(null);
  useEffect(() => {
    const before = wasAllowed.current;
    wasAllowed.current = allowed;
    if (val !== null && allowed === true && before === false) {
      val.system.patchSync.resume();
    }
  }, [val, allowed]);
}
