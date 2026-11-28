import type { PatchId } from "@valbuild/core";
import type { System } from "./createSystem";

/** How long an edit's save is waited for before its version is guessed. */
const SAVE_WAIT_MS = 60_000;

/**
 * The server's content version once `patchId` is saved: the version its save
 * made (`patch:saved`'s `headVersion`), or the stat's after it where the
 * server versions nothing in the answer, or `null`. A save that has not come
 * after a minute answers the version known then, so a render id waiting on it
 * (`proposals/renders.ts`) does not hold every id after it for good.
 */
export function savedSeqOf(
  system: System,
  patchId: PatchId,
): Promise<number | null> {
  return new Promise((resolve) => {
    const done = (seq: number | null) => {
      off();
      clearTimeout(timer);
      resolve(seq);
    };
    const off = system.patchSync.events.on("patch:saved", (event) => {
      if (!event.patches.includes(patchId)) return;
      done(event.headVersion ?? system.stat.currentSeq() ?? null);
    });
    const timer = setTimeout(
      () => done(system.stat.currentSeq() ?? null),
      SAVE_WAIT_MS,
    );
  });
}
