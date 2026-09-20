import { useCallback, useEffect, useRef } from "react";

/**
 * How long a field waits after the last keystroke before it writes a patch.
 *
 * Short enough to feel immediate — the input itself never waits, it holds the
 * typed value in local state — and long enough that a word is one patch.
 */
export const FIELD_WRITE_DEBOUNCE_MS = 250;

/**
 * The longest a field may go WITHOUT writing while someone is still typing.
 *
 * A trailing debounce alone assumes typing has pauses in it, and fluent typing
 * does not have them: at 60 WPM the gap between keystrokes is about 200ms,
 * which is under {@link FIELD_WRITE_DEBOUNCE_MS}, so every character restarts
 * the timer and the write never happens. Not "happens late" — does not happen,
 * for as long as the sentence takes.
 *
 * That is invisible in the field, which renders local state, and very visible
 * everywhere else: the list row naming the value, the heading, the page in the
 * canvas all sit on the pre-edit source until the typing stops. It reads as the
 * editor having lost the connection rather than as a write being coalesced.
 *
 * So the debounce is capped. Whatever has been typed is written at least this
 * often, and the cap is measured from the first keystroke of a run rather than
 * from the last, so it fires DURING typing instead of waiting for a pause that
 * may not come.
 */
export const FIELD_WRITE_MAX_WAIT_MS = 2000;

export type DebouncedFieldWrite<T> = {
  /** Record a new value. The write happens once typing pauses. */
  push(value: T): void;
  /** Write now, if anything is pending. For blur, submit, and unmount. */
  flush(): void;
  /**
   * Whether a typed value has not been written yet.
   *
   * Read by the field to decide whether an incoming source value is news or
   * merely the pre-edit value it is about to replace — see `StringField`.
   */
  hasPending(): boolean;
};

/**
 * Coalesce a field's writes, without making the input wait for them.
 *
 * A text field used to create one patch per KEYSTROKE. Every one of those is a
 * patch record in the chain, a source rebuild, a wake for every listener on the
 * module, and eventually a row on the server — so a paragraph typed into a
 * string field left a few hundred patches behind it, which is how a project
 * accumulates a chain long enough to break the request that reads it (see
 * `chunkPatchIds`) and a publish long enough to notice.
 *
 * It also showed: a validation error under the field appeared and cleared as the
 * value crossed in and out of valid mid-word, and everything below it — a rich
 * text editor's toolbar, most visibly — jumped by the height of the message each
 * time. Nothing was re-rendering; it was being pushed around.
 *
 * The value the user sees is local state and updates on every keystroke, as
 * before. Only the patch waits — and, per {@link FIELD_WRITE_MAX_WAIT_MS}, it
 * does not wait indefinitely just because the typing has no pauses in it.
 *
 * ## Two timers, and why the cap is armed from the FIRST keystroke
 *
 * `delayMs` restarts on every keystroke; that is the coalescing. `maxWaitMs`
 * does not — it is armed by the keystroke that starts a run and left alone, so
 * it expires mid-run and forces the write. Restarting it too would make it a
 * second debounce with a longer delay, which for continuous typing never fires
 * either, and the whole point is to have one timer that a fast typist cannot
 * keep pushing away.
 *
 * Either timer firing writes the pending value and ends the run, so the next
 * keystroke arms a fresh cap. A run that ends in a pause therefore costs one
 * write, exactly as before: the cap changes nothing for typing that has gaps in
 * it, and everything for typing that does not.
 *
 * ## Flushing is not optional
 *
 * A pending write that is never flushed is a lost edit, so `flush` runs on
 * unmount as well as on blur: navigating away from a field mid-word must not
 * throw the word away. The written value comes from a ref for the same reason —
 * the cleanup runs after the last render, and the callback it closed over at
 * mount would write the wrong thing.
 */
export function useDebouncedFieldWrite<T>(
  write: (value: T) => void,
  delayMs: number = FIELD_WRITE_DEBOUNCE_MS,
  maxWaitMs: number = FIELD_WRITE_MAX_WAIT_MS,
): DebouncedFieldWrite<T> {
  const writeRef = useRef(write);
  writeRef.current = write;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Non-null exactly while a run is open. See the note on arming, above. */
  const maxTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** A box, so "nothing pending" is distinguishable from "pending `undefined`". */
  const pending = useRef<{ value: T } | null>(null);

  /**
   * End the run and write what it holds.
   *
   * Both timers are cleared whichever one of them got here: they are two ways
   * of asking the same question, and a run is over once either has an answer.
   */
  const writePending = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (maxTimer.current !== null) {
      clearTimeout(maxTimer.current);
      maxTimer.current = null;
    }
    const next = pending.current;
    if (next === null) return;
    pending.current = null;
    writeRef.current(next.value);
  }, []);

  const push = useCallback(
    (value: T) => {
      pending.current = { value };
      if (timer.current !== null) {
        clearTimeout(timer.current);
      }
      timer.current = setTimeout(writePending, delayMs);
      // Only if this keystroke starts a run. An already-armed cap is left to
      // expire on its own schedule — restarting it here is exactly the bug it
      // exists to fix.
      if (maxTimer.current === null) {
        maxTimer.current = setTimeout(writePending, maxWaitMs);
      }
    },
    [delayMs, maxWaitMs, writePending],
  );

  const hasPending = useCallback(() => pending.current !== null, []);

  // Unmount, not every render: `writePending` is stable, so this attaches once.
  useEffect(() => writePending, [writePending]);

  return { push, flush: writePending, hasPending };
}
