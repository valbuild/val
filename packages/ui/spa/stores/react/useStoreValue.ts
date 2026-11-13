import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

/**
 * A value read off a store, which renders its reader when the VALUE moves
 * rather than when the store does.
 *
 * The hooks this replaces subscribed to a version counter and derived their
 * answer from it in a `useMemo`: `useSyncExternalStore(subscribe, () =>
 * store.chainVersion())`. The counter moves on every write, so every reader
 * rendered on every write -- to compute the answer it already had. Whether
 * anything is unpublished, which patches are committed, the settings module's
 * source: none of them move when a title is typed, and each one re-rendered
 * the shell for it (`docs/plans/studio-write-lag.md`).
 *
 * Here the derivation IS the snapshot, kept while it is the same answer
 * (`isSame`), which is the recompute-and-compare the validation and render
 * stores do (`architecture/stores.md`). So the store event still runs `read`,
 * and React hears nothing unless the answer moved.
 *
 * - `read` must be stable (a `useCallback`): a new one is a new question, and
 *   is read again on that render.
 * - `version`, when given, says whether `read` needs running at all: it is
 *   called on every render and after every event, so it must be cheap, and
 *   `read` runs only when it moved. Give one whenever `read` walks anything.
 * - `isSame` defaults to `Object.is`, which is right for a number, a string, a
 *   boolean, or an object the store itself keeps stable.
 */
export function useStoreValue<T>(
  subscribe: (onChange: () => void) => () => void,
  read: () => T,
  options: {
    isSame?: (previous: T, next: T) => boolean;
    version?: () => unknown;
  } = {},
): T {
  const { isSame = Object.is, version } = options;
  const kept = useRef<{
    read: () => T;
    version: unknown;
    value: T;
  } | null>(null);
  const getSnapshot = useCallback((): T => {
    const at = version?.();
    const previous = kept.current;
    if (
      previous !== null &&
      previous.read === read &&
      version !== undefined &&
      Object.is(previous.version, at)
    ) {
      return previous.value;
    }
    const next = read();
    const value =
      previous !== null && isSame(previous.value, next) ? previous.value : next;
    kept.current = { read, version: at, value };
    return value;
  }, [read, version, isSame]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * {@link useStoreValue} for an answer that can wait a moment: read AFTER the
 * store's event rather than inside it, once for a burst of events.
 *
 * For a derivation that walks something -- the chain against every field on
 * the page -- and decides only a marker: a dot, a count. The store's events
 * are emitted inside a field write, so reading there is work the write waits
 * for, and a write emits several (the patch, the source, the save). Here the
 * events only schedule the read, in a task of its own, and React hears of it
 * when the answer moved.
 *
 * A new `read` (a new question) is still answered in the render that asks it.
 */
export function useLateStoreValue<T>(
  subscribe: (onChange: () => void) => () => void,
  read: () => T,
  isSame: (previous: T, next: T) => boolean = Object.is,
): T {
  const asked = useMemo(() => read(), [read]);
  const [late, setLate] = useState<{ read: () => T; value: T } | null>(null);
  const answer = late !== null && late.read === read ? late.value : asked;
  const shown = useRef(answer);
  shown.current = answer;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      timer = null;
      const next = read();
      if (!isSame(shown.current, next)) setLate({ read, value: next });
    };
    const unsubscribe = subscribe(() => {
      if (timer === null) timer = setTimeout(refresh, 0);
    });
    return () => {
      unsubscribe();
      if (timer !== null) clearTimeout(timer);
    };
  }, [subscribe, read, isSame]);
  return answer;
}

/**
 * The previous reference while the value is the same one: for a value made
 * anew on each render (a set built from a list, a config parsed from an
 * answer) that is handed to a context or a `memo`, where a new reference is a
 * render of everything that reads it.
 */
export function useKept<T>(
  value: T,
  isSame: (previous: T, next: T) => boolean,
): T {
  const kept = useRef(value);
  if (kept.current !== value && !isSame(kept.current, value)) {
    kept.current = value;
  }
  return kept.current;
}

/**
 * One value that changes, for a provider to hand its readers in place of the
 * value itself. See {@link createValueStore}.
 */
export type ValueStore<T> = {
  get(): T;
  set(next: T): void;
  subscribe(onChange: () => void): () => void;
};

/**
 * A value that changes often, kept OUT of a context's value.
 *
 * A context that moves renders every component that reads it, whatever part
 * of it that component uses and whether or not its answer moved. Put the
 * store in the context instead -- it never changes -- and read it with
 * {@link useStoreValue}: a reader then renders when what it derives moves.
 * The provider `set`s it from an effect, never while rendering.
 */
export function createValueStore<T>(initial: T): ValueStore<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      if (Object.is(value, next)) return;
      value = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe(onChange) {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
  };
}

/** The same value all the way down: plain objects and arrays by content. */
export function sameDeep(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (
    typeof a !== "object" ||
    typeof b !== "object" ||
    a === null ||
    b === null
  ) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((item, index) => sameDeep(item, b[index]));
  }
  // Anything with a class of its own (a Map, a Date, an element) is the same
  // only when it is the same object, which `Object.is` already answered.
  const prototype = Object.getPrototypeOf(a);
  if (
    prototype !== Object.getPrototypeOf(b) ||
    (prototype !== Object.prototype && prototype !== null)
  ) {
    return false;
  }
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(b, key) &&
      sameDeep(Reflect.get(a, key), Reflect.get(b, key)),
  );
}

/** The same items in the same order. */
export function sameItems<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index++) {
    if (!Object.is(a[index], b[index])) return false;
  }
  return true;
}

/** The same members. */
export function sameMembers<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const member of a) {
    if (!b.has(member)) return false;
  }
  return true;
}

/** The same own keys with the same values, one level down. */
export function sameFields<T extends object>(a: T, b: T): boolean {
  if (a === b) return true;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const key of keys) {
    if (
      !Object.prototype.hasOwnProperty.call(b, key) ||
      !Object.is(Reflect.get(a, key), Reflect.get(b, key))
    ) {
      return false;
    }
  }
  return true;
}
