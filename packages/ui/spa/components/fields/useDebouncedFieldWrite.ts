import { useCallback, useEffect, useRef } from "react";

/**
 * How long a field waits after the last keystroke before it writes a patch.
 *
 * Short enough to feel immediate — the input itself never waits, it holds the
 * typed value in local state — and long enough that a word is one patch.
 */
export const FIELD_WRITE_DEBOUNCE_MS = 250;

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
 * `planPatchIdQuery`) and a publish long enough to notice.
 *
 * It also showed: a validation error under the field appeared and cleared as the
 * value crossed in and out of valid mid-word, and everything below it — a rich
 * text editor's toolbar, most visibly — jumped by the height of the message each
 * time. Nothing was re-rendering; it was being pushed around.
 *
 * The value the user sees is local state and updates on every keystroke, as
 * before. Only the patch waits.
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
): DebouncedFieldWrite<T> {
  const writeRef = useRef(write);
  writeRef.current = write;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** A box, so "nothing pending" is distinguishable from "pending `undefined`". */
  const pending = useRef<{ value: T } | null>(null);

  const flush = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
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
      timer.current = setTimeout(() => {
        timer.current = null;
        const next = pending.current;
        if (next === null) return;
        pending.current = null;
        writeRef.current(next.value);
      }, delayMs);
    },
    [delayMs],
  );

  const hasPending = useCallback(() => pending.current !== null, []);

  // Unmount, not every render: `flush` is stable, so this attaches once.
  useEffect(() => flush, [flush]);

  return { push, flush, hasPending };
}
