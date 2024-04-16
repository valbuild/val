"use client";
import { Json, ModuleId } from "@valbuild/core";
import React, { createContext } from "react";

export class ValEvents {
  private readonly subscribers: Map<SubscriberId, Record<ModuleId, Json>>; // uncertain whether this is the optimal way of returning
  private readonly listeners: Record<SubscriberId, (() => void)[]>;

  constructor() {
    this.subscribers = new Map();
    this.listeners = {};
  }

  subscribe = (moduleIds: ModuleId[]) => (listener: () => void) => {
    const subscriberId = createSubscriberId(moduleIds);
    if (!this.listeners[subscriberId]) {
      this.listeners[subscriberId] = [];
      this.subscribers.set(subscriberId, {});
    }
    this.listeners[subscriberId].push(listener);

    return () => {
      this.listeners[subscriberId].splice(
        this.listeners[subscriberId].indexOf(listener),
        1
      );
    };
  };

  update(moduleId: ModuleId, source: Json) {
    const subscriberIds = Array.from(this.subscribers.keys());
    for (const subscriberId of subscriberIds) {
      const isSubscribedToModule = subscriberId.includes(moduleId); // this should be accurate since the subscriber separator (;) is not a valid character in a module id
      if (isSubscribedToModule) {
        this.subscribers.set(subscriberId, {
          ...this.subscribers.get(subscriberId),
          [moduleId]: source,
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

  getSnapshot = (moduleIds: ModuleId[]) => () => {
    return this.get(moduleIds);
  };

  getServerSnapshot = (moduleIds: ModuleId[]) => () => {
    return this.get(moduleIds);
  };

  get = (moduleIds: ModuleId[]): Record<ModuleId, Json> | undefined => {
    const subscriberId = createSubscriberId(moduleIds);
    return this.subscribers.get(subscriberId);
  };
}
type SubscriberId = string & {
  readonly _tag: unique symbol;
};

function createSubscriberId(moduleIds: ModuleId[]): SubscriberId {
  return moduleIds.slice().sort().join("&") as SubscriberId;
}

export type ValContext = {
  readonly valEvents?: ValEvents;
  readonly enabled: boolean;
};

export const ValContext = createContext<ValContext>({
  valEvents: undefined,
  enabled: false,
});

export const useValEvents = () => {
  return React.useContext(ValContext).valEvents;
};
