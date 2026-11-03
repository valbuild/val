import { useEffect, useState } from "react";
import type { SaveState } from "./StatusBar";
import { isSaveStuck, type SyncState } from "../../stores/PatchSync";

/**
 * What the status bar says about saving, from everything that decides it.
 *
 * Patches are applied locally first, so the editor never waits on a round
 * trip to show a change; the question this answers is whether the change has
 * reached the server. Two inputs used to answer it -- "are there unsaved
 * patches" and "is the service unavailable" -- and neither was the write
 * queue itself. So when a save failed and the patch was dropped, nothing was
 * unsaved any more and the bar said "All changes saved" over an edit that had
 * just been lost.
 *
 * The queue is read first because it is the one input that knows a save
 * FAILED rather than merely did not happen yet:
 *
 * - `failed` (the content service would not take it) and a retry that has
 *   gone on long enough to be reported (`isSaveStuck`) are "error". Never
 *   "saving", which reads as "wait", and never "saved".
 * - Anything else that is not `in-sync` is "saving": queued, in flight, or
 *   retrying a blip. A plan refusal is here too -- the edit is kept and the
 *   shell says why beside the fix, so the bar does not say it twice.
 * - `in-sync` with nothing unsaved is the only "saved".
 */
export function saveStateOf(inputs: {
  sync: SyncState | null;
  /** Patches made here that the server has not acknowledged. */
  unsavedCount: number;
  hasPatchErrors: boolean;
  serviceUnavailable: boolean;
}): SaveState {
  const { sync } = inputs;
  if (sync !== null && isSaveStuck(sync)) return "error";
  if (inputs.hasPatchErrors || inputs.serviceUnavailable) return "error";
  if (inputs.unsavedCount > 0) return "saving";
  if (sync !== null && sync.status !== "in-sync") return "saving";
  return "saved";
}

/**
 * How long "Saving…" stays up after the last write lands.
 *
 * Longer than the gap between two writes of someone typing: a field writes on
 * a pause of 250 ms, and the round trip is tens to a couple of hundred more,
 * so the writes of a sentence arrive a few hundred milliseconds apart.
 * Measured in the Studio, the gaps between them topped out around 600 ms.
 */
export const SAVED_SETTLE_MS = 800;

/**
 * The save state as the status bar SHOWS it: steady while someone types.
 *
 * The raw state is "is a write in flight", and while someone types that is
 * true for a hundred milliseconds and false for the next three hundred, over
 * and over. Drawn as it is, the status bar flipped between "Saving…" and "All
 * changes saved" once per pause in typing, some of them for under a frame's
 * worth of attention, which is how it was reported: as blinking.
 *
 * So a save is taken to be a burst. "Saving…" shows as soon as a write starts,
 * which is when it is news, and stays until no write has been in flight for
 * {@link SAVED_SETTLE_MS}. A paragraph reads as one save instead of forty.
 *
 * An error is never held back or held on to: "Could not save" is the one state
 * someone has to act on, so it shows the moment it is true, and a recovery
 * shows the moment it is true too.
 */
export function useSteadySaveState(raw: SaveState): SaveState {
  const [shown, setShown] = useState<SaveState>(raw);

  useEffect(() => {
    if (raw !== "saved") {
      setShown(raw);
      return;
    }
    /*
     * Only "saving" waits. From "error" the way to "saved" is the problem
     * going away, and holding "Could not save" on screen after it has would
     * be the opposite of the point.
     */
    if (shown !== "saving") {
      setShown("saved");
      return;
    }
    const timer = setTimeout(() => setShown("saved"), SAVED_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [raw, shown]);

  /*
   * Decided at render time, not only in the effect, so neither a write
   * starting nor an error is a frame late. The one thing `shown` can add is a
   * held "saving".
   */
  if (raw !== "saved") return raw;
  return shown === "saving" ? "saving" : "saved";
}
