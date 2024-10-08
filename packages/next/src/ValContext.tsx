"use client";
import { Json, ModuleFilePath } from "@valbuild/core";
import React from "react";

export class ValEvents {
  private readonly subscribers: Map<SubscriberId, Record<ModuleFilePath, Json>>; // uncertain whether this is the optimal way of returning
  private readonly listeners: Record<SubscriberId, (() => void)[]>;

  constructor() {
    this.subscribers = new Map();
    this.listeners = {};
  }

  reloadPaths(paths: ModuleFilePath[]) {
    const event = new CustomEvent("val-store", {
      detail: {
        type: "reload-paths",
        paths,
      },
    });
    window.dispatchEvent(event);
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
}
type SubscriberId = string & {
  readonly _tag: unique symbol;
};

function createSubscriberId(paths: ModuleFilePath[]): SubscriberId {
  return paths.slice().sort().join("&") as SubscriberId;
}

export type ValContext = {
  readonly valEvents?: ValEvents;
  readonly enabled: boolean;
};

export const ValContext = React.createContext<ValContext>({
  valEvents: undefined,
  enabled: false,
});

export const useValEvents = () => {
  return React.useContext(ValContext).valEvents;
};
