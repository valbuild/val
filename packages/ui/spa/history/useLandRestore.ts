import type { PatchId } from "@valbuild/core";
import { useCallback } from "react";
import { isSaveStuck } from "../stores/PatchSync";
import { useValSystem } from "../stores/react/SystemContext";
import {
  landRestore,
  type LandResult,
  type RestoreDestination,
  type SavePatches,
} from "./restoreDestination";

/**
 * How long to wait for this tab's queue to reach the server before saying it
 * has not. Long, as the publish's own wait is: a slow save is not a failed one.
 */
const SAVE_WAIT_MS = 30_000;

/**
 * Hand the patches a restore wrote to where restores go. See
 * `restoreDestination.ts`.
 */
export function useLandRestore(
  destination: RestoreDestination,
): (
  patchIds: PatchId[],
  displayName: string,
  restoreCodeFrom?: string,
) => Promise<LandResult> {
  const save = useSavePatches();
  return useCallback(
    (patchIds, displayName, restoreCodeFrom) =>
      landRestore({
        destination,
        save,
        patchIds,
        displayName,
        ...(restoreCodeFrom !== undefined ? { restoreCodeFrom } : {}),
      }),
    [destination, save],
  );
}

/**
 * Send this tab's unsaved patches now, and say whether these ones made it.
 *
 * Waits on the sync's own flush, and stops early when the sync calls the save
 * stuck (a refusal it will not retry) or after {@link SAVE_WAIT_MS}: a flush
 * keeps retrying for as long as the network is down, and a restore waiting on
 * it would wait without saying so.
 */
export function useSavePatches(): SavePatches {
  const val = useValSystem();
  return useCallback<SavePatches>(
    async (patchIds) => {
      if (val === null) {
        return {
          status: "error",
          message: "No store system is mounted, so nothing can be saved.",
        };
      }
      const { patchSync, patchStore } = val.system;
      let stopWaiting = () => {};
      await Promise.race([
        patchSync.flush().catch(() => undefined),
        new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, SAVE_WAIT_MS);
          const off = patchSync.events.on("patch:sync-state", (event) => {
            if (isSaveStuck(event.state)) resolve();
          });
          stopWaiting = () => {
            clearTimeout(timer);
            off();
          };
        }),
      ]);
      stopWaiting();
      const wanted = new Set<string>(patchIds);
      const unsaved = patchStore
        .unsavedRecords()
        .filter((record) => wanted.has(record.patchId));
      if (unsaved.length === 0) return { status: "ok" };
      const syncState = patchSync.currentState();
      return {
        status: "error",
        // Held for the plan: "try again" cannot help, and Val Build's own
        // sentence says what can.
        message:
          syncState.status === "refused"
            ? syncState.message
            : "Val Build has not taken it yet. Try again in a moment.",
      };
    },
    [val],
  );
}
