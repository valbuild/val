import type { ModuleFilePath, SourcePath } from "@valbuild/core";
import { useCallback, useEffect, useId, useSyncExternalStore } from "react";
import { useValSystem } from "../../stores/react/SystemContext";
import type { ExternalKeysState } from "../../stores/SourceStore";

/**
 * What is known of an external record's keys, and how to ask for more.
 *
 * The one thing an external record needs that no other storage mode does. A
 * `.jsonValues()` record's keys are in its own source — the module lists them,
 * and only their CONTENT is loaded on demand. An external record's source is a
 * marker, so the key list itself has to be fetched, a page at a time, in the
 * order the store hands them over.
 *
 * That is also why it is a growing prefix plus a cursor rather than an
 * offset: a cursor-paged store cannot be asked for "page 7" without having
 * walked to it, and an offset into a live store would mean counting rows it has
 * already forgotten about.
 */
export function useExternalRecordKeys(
  moduleFilePath: ModuleFilePath,
  enabled: boolean,
): ExternalKeysState & { loadMore: () => void } {
  const val = useValSystem();
  const sourceStore = val?.system.sourceStore;
  const listenerId = useId();

  const subscribe = useCallback(
    (onChange: () => void) => {
      if (sourceStore === undefined || !enabled) {
        return () => {};
      }
      // The module root is a path like any other, so this uses the same
      // per-path listener registry every field uses: a key page arriving bumps
      // the module, and only listeners on it are woken.
      return sourceStore.addListener(
        moduleFilePath as unknown as SourcePath,
        listenerId,
        onChange,
      );
    },
    [sourceStore, moduleFilePath, enabled, listenerId],
  );
  const getSnapshot = useCallback(() => {
    if (sourceStore === undefined || !enabled) {
      return EMPTY;
    }
    return sourceStore.externalKeysState(moduleFilePath);
  }, [sourceStore, moduleFilePath, enabled]);
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // The first page, once. Everything after it is asked for by the pager, so a
  // record nobody scrolls costs exactly one request.
  useEffect(() => {
    if (!enabled || sourceStore === undefined) {
      return;
    }
    void sourceStore.loadExternalKeys(moduleFilePath);
  }, [enabled, sourceStore, moduleFilePath]);

  const loadMore = useCallback(() => {
    if (!enabled || sourceStore === undefined) {
      return;
    }
    void sourceStore.loadExternalKeys(moduleFilePath);
  }, [enabled, sourceStore, moduleFilePath]);

  return { ...state, loadMore };
}

const EMPTY: ExternalKeysState = { keys: [], cursor: null, loading: false };
