"use client";
import { Json, ModuleFilePath } from "@valbuild/core";
import React from "react";

export class ValExternalStore {
  private readonly subscribers: Map<SubscriberId, Record<ModuleFilePath, Json>>; // uncertain whether this is the optimal way of returning
  private readonly listeners: Record<SubscriberId, (() => void)[]>;
  private readonly loadPromises: Map<SubscriberId, Promise<void>>;
  // Path-keyed cache of every source seen via update(). Independent of the
  // per-subscriberId records so load state can be queried for any combination
  // of paths, even ones no subscriber has registered yet.
  private readonly loadedSources: Map<ModuleFilePath, Json>;

  constructor() {
    this.subscribers = new Map();
    this.listeners = {};
    this.loadPromises = new Map();
    this.loadedSources = new Map();
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
      const unsubscribe = this.subscribe(paths)(() => {
        if (this.hasAllLoaded(paths)) {
          unsubscribe();
          this.loadPromises.delete(subscriberId);
          resolve();
        }
      });
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
