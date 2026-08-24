import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useSyncExternalStore,
} from "react";
import type { Json, ModuleFilePath, SourcePath } from "@valbuild/core";
import { useValSystem } from "./SystemContext";

/**
 * The value at one path, and why there isn't one.
 *
 * Deliberately the same union `ValFieldProvider.useSourceAtPath` returns, so a
 * component can be moved from one to the other without its rendering changing.
 */
export type SourceAtPath =
  | { status: "success"; data: Json }
  | { status: "error"; error: string }
  | { status: "not-found" }
  | { status: "loading" };

const LOADING: SourceAtPath = { status: "loading" };
const NOT_FOUND: SourceAtPath = { status: "not-found" };
const NO_SYSTEM: SourceAtPath = { status: "not-found" };

/** `useSyncExternalStore` needs a stable no-op when there is no system. */
const noopSubscribe = () => () => {};

/**
 * Read the source at one path, and be woken when it moves.
 *
 * ## One subscription per PATH
 *
 * This is the difference from the engine, and it is the measured one. The engine
 * subscribes per module and walks the path in the hook, so every mounted field in
 * an edited module re-renders on every keystroke: 16 of 16 at the benchmark's
 * screen size. This subscribes to the path, so a keystroke wakes the fields whose
 * own value moved — 0 in the same measurement, because the only field showing that
 * path was the one being typed into, and per-instance suppression leaves it alone.
 *
 * ## Why the read is synchronous
 *
 * `getSnapshot` cannot be async, and it does not need to be: `peek` resolves the
 * path and returns the value without any chance of doing work. That is what makes
 * a mounting field paint once instead of twice — see `openquestions.md` item 1,
 * where an async read measured 32 mount renders against the engine's 16.
 *
 * ## The one case that IS asynchronous
 *
 * A path inside a `.jsonValues()` entry whose content has not been fetched. `peek`
 * says `entry-missing`; the effect below calls `get`, which fetches; the store
 * wakes this listener when the content lands. The fetch is NOT started during
 * render — it is a side effect, and a render-phase fetch in a component React may
 * re-run or throw away is how a fetch storm starts.
 */
export function useSourceAtPath(
  sourcePath: SourcePath | ModuleFilePath,
  /**
   * This reader's field-instance id, if it also WRITES.
   *
   * Suppression is per instance, and the id the store compares is the one passed
   * to `createPatch`. So a component that both reads and writes has to give both
   * hooks the SAME id — and `useId()` returns a different value per hook call, so
   * letting each default is precisely how a field ends up woken by its own
   * keystroke. {@link useValField} exists so that is not something to remember.
   *
   * Omit it for a read-only reader: the default is this hook's own `useId`, which
   * is a distinct instance and correctly gets woken by everything.
   */
  fieldId?: string,
): SourceAtPath {
  const val = useValSystem();
  const path = sourcePath as SourcePath;
  /**
   * This reader's own id, when the caller did not supply one.
   *
   * `useId` rather than anything derived from the path, because suppression is
   * per instance: the same path rendered twice — a studio field and an inline
   * overlay — must be two listeners, so that an edit in one wakes the other. A
   * path-derived id would make them one and the overlay would go stale.
   *
   * Called unconditionally, because a hook cannot be called conditionally.
   */
  const ownId = useId();
  const listenerId = fieldId ?? ownId;

  const subscribe = useCallback(
    (onChange: () => void) => {
      if (val === null) {
        return () => {};
      }
      return val.system.sourceStore.addListener(path, listenerId, onChange);
    },
    [val, path, listenerId],
  );

  const getSnapshot = useCallback(() => {
    if (val === null) {
      return null;
    }
    return val.snapshots.get(val.system.sourceStore, path);
  }, [val, path]);

  const seen = useSyncExternalStore(
    val === null ? noopSubscribe : subscribe,
    getSnapshot,
    getSnapshot,
  );

  /**
   * Ask for entry content that is not here.
   *
   * Only on `entry-missing`. NOT on `entry-failed`: that is the whole reason the
   * store distinguishes them — retrying a fetch that just failed, from an effect
   * that re-runs when the status changes, is an infinite loop that renders as a
   * spinner.
   */
  useEffect(() => {
    if (val === null || seen === null || seen.status !== "entry-missing") {
      return;
    }
    void val.system.sourceStore.get(path, null);
  }, [val, path, seen]);

  return useMemo<SourceAtPath>(() => {
    if (val === null || seen === null) {
      return NO_SYSTEM;
    }
    switch (seen.status) {
      case "ready":
        return { status: "success", data: seen.data };
      case "absent":
        return NOT_FOUND;
      case "module-loading":
      case "entry-missing":
      case "entry-loading":
        return LOADING;
      case "entry-failed":
        // A failed load must not render as a perpetual spinner — the same rule
        // the engine's `getJsonEntryError` exists for.
        return {
          status: "error",
          error: `Could not load entry '${seen.key}': ${seen.message}`,
        };
    }
  }, [val, seen]);
}
