import { Json, ModuleId, ValApi } from "@valbuild/core";
import { result } from "@valbuild/core/fp";
import type { IValStore } from "@valbuild/shared/internal";

type SubscriberId = string & {
  readonly _tag: unique symbol;
};

export class ValStore implements IValStore {
  private readonly subscribers: Map<SubscriberId, Record<ModuleId, Json>>; // uncertain whether this is the optimal way of returning
  private readonly listeners: Record<SubscriberId, (() => void)[]>;

  constructor(private readonly api: ValApi) {
    this.subscribers = new Map();
    this.listeners = {};
  }

  async update(moduleIds: ModuleId[]) {
    await Promise.all(moduleIds.map((moduleId) => this.updateTree(moduleId)));
  }

  async updateAll() {
    await this.updateTree();
  }

  async updateTree(treePath?: string) {
    const data = await this.api.getTree({
      treePath,
      patch: true,
      includeSource: true,
    });
    if (result.isOk(data)) {
      const updatedSubscriberIds = new Map<SubscriberId, ModuleId[]>();
      const subscriberIds = Array.from(this.subscribers.keys());

      // Figure out which modules have been updated and map to updated subscribed id
      for (const moduleId of Object.keys(data.value.modules) as ModuleId[]) {
        const source = data.value.modules[moduleId].source;
        if (typeof source !== "undefined") {
          const updatedSubscriberId = subscriberIds.find(
            (subscriberId) => subscriberId.includes(moduleId) // NOTE: dependent on
          );
          if (updatedSubscriberId) {
            updatedSubscriberIds.set(
              updatedSubscriberId,
              (updatedSubscriberIds.get(updatedSubscriberId) || []).concat(
                moduleId
              )
            );
          }
        }
      }

      // For all updated subscribers: set new module data and emit change
      for (const [updatedSubscriberId, moduleIds] of Array.from(
        updatedSubscriberIds.entries()
      )) {
        const subscriberModules = Object.fromEntries(
          moduleIds.flatMap((moduleId) => {
            const source = data.value.modules[moduleId].source;
            if (!source) {
              return [];
            }
            return [[moduleId, source]];
          })
        );
        this.subscribers.set(updatedSubscriberId, subscriberModules);
        this.emitChange(updatedSubscriberId);
      }
    } else {
      console.error("Val: failed to update modules", data.error);
    }
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

function createSubscriberId(moduleIds: ModuleId[]): SubscriberId {
  return moduleIds.slice().sort().join("&") as SubscriberId;
}
