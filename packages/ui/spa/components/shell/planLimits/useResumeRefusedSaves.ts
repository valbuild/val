import { useEffect } from "react";
import { useValSystem } from "../../../stores/react/SystemContext";
import type { StudioAccess } from "./studioAccess";

/**
 * Whether Val Build says this project's edits can be saved now. False while
 * it has not said: then the sync's own timed retry is what sends them.
 */
export function editAllowed(access: StudioAccess | null): boolean {
  if (access === null || access.plan?.access !== "edit") return false;
  return access.limits?.refused.edit === undefined;
}

/**
 * Send the edits a plan refusal held back as soon as Val Build says editing
 * is allowed again -- an owner added a card, or the Free week moved on --
 * rather than when the sync's minute runs out (`REFUSED_RETRY_MS`).
 *
 * On every new answer that allows it, not only on the change to allowed: a
 * save can be refused between two answers that both said yes. `resume` does
 * nothing when no refusal is holding the queue.
 */
export function useResumeRefusedSaves(access: StudioAccess | null): void {
  const val = useValSystem();
  useEffect(() => {
    if (val !== null && editAllowed(access)) val.system.patchSync.resume();
  }, [val, access]);
}
