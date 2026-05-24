"use client";
import { Json, ModuleFilePath } from "@valbuild/core";
import React from "react";

// How long waitForLoad waits for draft data before giving up and resolving
// anyway (logging an error) so the Suspense boundary never hangs forever.
const LOAD_TIMEOUT_MS = 10000;

export class ValExternalStore {
  private readonly subscribers: Map<SubscriberId, Record<ModuleFilePath, Json>>; // uncertain whether this is the optimal way of returning
  private readonly listeners: Record<SubscriberId, (() => void)[]>;
  private readonly loadPromises: Map<SubscriberId, Promise<void>>;
  // Path-keyed cache of every source seen via update(). Independent of the
  // per-subscriberId records so load state can be queried for any combination
  // of paths, even ones no subscriber has registered yet.
  private readonly loadedSources: Map<ModuleFilePath, Json>;
  // One-shot listeners used solely by waitForLoad. Kept separate from the
  // useSyncExternalStore subscribers/listeners so waitForLoad never has to
  // register (and leak) a subscriberId.
  private readonly loadListeners: Set<() => void>;

  constructor() {
    this.subscribers = new Map();
    this.listeners = {};
    this.loadPromises = new Map();
    this.loadedSources = new Map();
    this.loadListeners = new Set();
  }

  subscribe = (paths: ModuleFilePath[]) => (listener: () => void) => {
    const subscriberId = createSubscriberId(paths);
    if (!this.listeners[subscriberId]) {
      this.listeners[subscriberId] = [];
      this.subscribers.set(subscriberId, {});
    }
    this.listeners[subscriberId].push(listener);

    return () => {
      this.listeners[subscriberId].splice(
        this.listeners[subscriberId].indexOf(listener),
        1,
      );
    };
  };

  update(path: ModuleFilePath, source: Json) {
    this.loadedSources.set(path, source);
    const subscriberIds = Array.from(this.subscribers.keys());
    for (const subscriberId of subscriberIds) {
      const isSubscribedToModule = subscriberId.includes(path); // TODO: hash paths instead
      if (isSubscribedToModule) {
        this.subscribers.set(subscriberId, {
          ...this.subscribers.get(subscriberId),
          [path]: source,
        });
        this.emitChange(subscriberId);
      }
    }
    for (const listener of Array.from(this.loadListeners)) {
      listener();
    }
  }

  private emitChange(subscriberId: SubscriberId) {
    for (const listener of this.listeners[subscriberId]) {
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
    return this.subscribers.get(subscriberId);
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
}>({
  store: undefined,
  draftMode: false,
});

export function ValOverlayProvider({
  store,
  draftMode,
  children,
}: {
  store?: ValExternalStore;
  draftMode: boolean | null;
  children: React.ReactNode;
}) {
  return (
    <ValOverlayContext.Provider value={{ store, draftMode }}>
      {children}
    </ValOverlayContext.Provider>
  );
}

export const useValOverlayContext = () => {
  return React.useContext(ValOverlayContext);
};
