"use client";
import { Json, ModuleFilePath } from "@valbuild/core";
import React from "react";

// How long waitForLoad waits for draft data before giving up and resolving
// anyway (logging an error) so the Suspense boundary never hangs forever.
const LOAD_TIMEOUT_MS = 10000;

export class ValExternalStore {
  private readonly listeners: Map<SubscriberId, (() => void)[]>;
  private readonly loadPromises: Map<SubscriberId, Promise<void>>;
  // Path-keyed cache of every source seen via update(). The single source of
  // truth: load state and snapshots are both derived from this, so data can be
  // queried for any combination of paths even before a subscriber registers.
  private readonly loadedSources: Map<ModuleFilePath, Json>;
  // Reference-stable per-subscriberId snapshot cache for useSyncExternalStore.
  // Built lazily from loadedSources in get() and invalidated in update().
  private readonly snapshots: Map<
    SubscriberId,
    Record<ModuleFilePath, Json> | undefined
  >;
  // One-shot listeners used solely by waitForLoad. Kept separate from the
  // useSyncExternalStore listeners so waitForLoad never has to register (and
  // leak) a subscriberId.
  private readonly loadListeners: Set<() => void>;

  constructor() {
    this.listeners = new Map();
    this.loadPromises = new Map();
    this.loadedSources = new Map();
    this.snapshots = new Map();
    this.loadListeners = new Set();
  }

  subscribe = (paths: ModuleFilePath[]) => (listener: () => void) => {
    const subscriberId = createSubscriberId(paths);
    const existing = this.listeners.get(subscriberId);
    if (existing) {
      existing.push(listener);
    } else {
      this.listeners.set(subscriberId, [listener]);
    }

    return () => {
      const current = this.listeners.get(subscriberId);
      if (current) {
        current.splice(current.indexOf(listener), 1);
      }
    };
  };

  update(path: ModuleFilePath, source: Json) {
    this.loadedSources.set(path, source);
    // Invalidate cached snapshots that include this path so the next get()
    // rebuilds a fresh (new-reference) record, then notify their listeners.
    for (const subscriberId of Array.from(this.snapshots.keys())) {
      if (subscriberId.includes(path)) {
        // TODO: hash paths instead
        this.snapshots.delete(subscriberId);
      }
    }
    for (const subscriberId of this.listeners.keys()) {
      if (subscriberId.includes(path)) {
        this.emitChange(subscriberId);
      }
    }
    for (const listener of Array.from(this.loadListeners)) {
      listener();
    }
  }

  private emitChange(subscriberId: SubscriberId) {
    for (const listener of this.listeners.get(subscriberId) ?? []) {
      listener();
    }
  }

  getSnapshot = (paths: ModuleFilePath[]) => () => {
    return this.get(paths);
  };

  getServerSnapshot = (paths: ModuleFilePath[]) => () => {
    return this.get(paths);
  };

  get = (paths: ModuleFilePath[]): Record<ModuleFilePath, Json> | undefined => {
    const subscriberId = createSubscriberId(paths);
    if (this.snapshots.has(subscriberId)) {
      return this.snapshots.get(subscriberId);
    }
    // Build the snapshot from the path-keyed loadedSources so data that arrived
    // before this subscriber registered is still returned. Cache it for a
    // reference-stable result (required by useSyncExternalStore).
    let record: Record<ModuleFilePath, Json> | undefined;
    for (const p of paths) {
      // Json never holds `undefined`, so a defined value means the path loaded.
      const loaded = this.loadedSources.get(p);
      if (loaded !== undefined) {
        if (!record) {
          record = {};
        }
        record[p] = loaded;
      }
    }
    this.snapshots.set(subscriberId, record);
    return record;
  };

  hasAllLoaded = (paths: ModuleFilePath[]): boolean => {
    for (const p of paths) {
      if (!this.loadedSources.has(p)) {
        return false;
      }
    }
    return true;
  };

  /**
   * Returns a cached promise that resolves once `update()` has populated
   * every path in `paths`. The same promise instance is returned for the
   * same paths until it resolves — required so `React.use` / classic
   * Suspense doesn't re-suspend on every render.
   *
   * If the data never arrives (network failure, a path that is never
   * `update()`'d, a typo in a module path) the promise would otherwise hang
   * forever and keep the Suspense boundary in its fallback. To avoid a silent
   * hang it resolves anyway after `LOAD_TIMEOUT_MS`, logging an error so the
   * failure is diagnosable while the page still renders with partial data.
   */
  waitForLoad = (paths: ModuleFilePath[]): Promise<void> => {
    if (this.hasAllLoaded(paths)) {
      return Promise.resolve();
    }
    const subscriberId = createSubscriberId(paths);
    const existing = this.loadPromises.get(subscriberId);
    if (existing) {
      return existing;
    }
    const promise = new Promise<void>((resolve) => {
      const cleanup = () => {
        clearTimeout(timeout);
        this.loadListeners.delete(listener);
        this.loadPromises.delete(subscriberId);
      };
      const listener = () => {
        if (this.hasAllLoaded(paths)) {
          cleanup();
          resolve();
        }
      };
      const timeout = setTimeout(() => {
        const missing = paths.filter((p) => !this.loadedSources.has(p));
        console.error(
          `Val: draft module(s) did not load within ${LOAD_TIMEOUT_MS}ms; rendering with partial data. Missing: ${missing.join(", ")}`,
        );
        cleanup();
        resolve();
      }, LOAD_TIMEOUT_MS);
      // Don't let the pending timer keep a Node process (e.g. the test runner
      // or SSR) alive; setTimeout returns a number in the browser, where there
      // is nothing to unref.
      if (typeof timeout !== "number") {
        timeout.unref();
      }
      this.loadListeners.add(listener);
    });
    this.loadPromises.set(subscriberId, promise);
    return promise;
  };
}
type SubscriberId = string & {
  readonly _tag: unique symbol;
};

function createSubscriberId(paths: ModuleFilePath[]): SubscriberId {
  return paths.slice().sort().join("&") as SubscriberId;
}

export const ValOverlayContext = React.createContext<{
  readonly store?: ValExternalStore;
  readonly draftMode: boolean | null;
  // Whether Val is enabled (the VAL_ENABLE cookie is set). Unlike draftMode
  // this is stable for the lifetime of the page, so it is what gates the
  // Suspense call in useValStega.
  readonly enabled: boolean;
}>({
  store: undefined,
  draftMode: false,
  enabled: false,
});

export function ValOverlayProvider({
  store,
  draftMode,
  enabled,
  children,
}: {
  store?: ValExternalStore;
  draftMode: boolean | null;
  enabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <ValOverlayContext.Provider value={{ store, draftMode, enabled }}>
      {children}
    </ValOverlayContext.Provider>
  );
}

export const useValOverlayContext = () => {
  return React.useContext(ValOverlayContext);
};
