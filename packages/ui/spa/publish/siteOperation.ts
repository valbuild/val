/**
 * One site operation at a time, in this page: a publish or an update.
 *
 * The deploy under both already refuses to run twice, but that guards only
 * the BUILD. Each operation has a half before it -- a publish saves, an update
 * starts, which copies the template's layer into the project -- and a publish
 * pressed during an update's start would save and then find the deploy taken,
 * leaving its change saved and not live. So the whole operation holds this,
 * and the second one is refused at the press, with a sentence, before it has
 * done anything.
 *
 * Module state because the two are started from components that share
 * nothing: the publish button's provider, and the settings panel.
 */

export type SiteOperation = "publish" | "update";

let running: SiteOperation | null = null;

/**
 * Take the lock, or learn who has it. `release` is idempotent, so a caller can
 * put it in a `finally` and also call it early.
 */
export function beginSiteOperation(
  operation: SiteOperation,
): { ok: true; release: () => void } | { ok: false; busy: SiteOperation } {
  if (running !== null) return { ok: false, busy: running };
  running = operation;
  let released = false;
  return {
    ok: true,
    release: () => {
      if (released) return;
      released = true;
      running = null;
    },
  };
}

export function busyMessage(busy: SiteOperation): string {
  return busy === "update"
    ? "Your site is being updated. Publish when the update is done."
    : "A publish is running. Update when it is done.";
}
