import { Json, ModuleId, ValApi } from "@valbuild/core";
import { result } from "@valbuild/core/fp";
import { JSONOps, Patch, PatchError, applyPatch } from "@valbuild/core/patch";
import type { IValStore } from "@valbuild/shared/internal";

type SubscriberId = string & {
  readonly _tag: unique symbol;
};

const ops = new JSONOps();

export class ValStore implements IValStore {
  private readonly subscribers: Map<SubscriberId, Record<ModuleId, Json>>; // uncertain whether this is the optimal way of returning
  private readonly listeners: Record<SubscriberId, (() => void)[]>;

  private readonly sources: Record<ModuleId, Json>;
  private readonly drafts: Record<ModuleId, Json>;
  private readonly patches: [ModuleId, Patch][];

  constructor(
    private readonly api: ValApi,
    sources?: Record<ModuleId, Json>,
    patches?: [ModuleId, Patch][],
    drafts?: Record<ModuleId, Json>
  ) {
    this.subscribers = new Map();
    this.listeners = {};
    this.sources = sources || {};
    this.patches = patches || [];
    this.drafts = drafts || {};
  }

  async applyPatch(
    moduleId: ModuleId,
    patch: Patch
  ): Promise<
    result.Result<
      undefined, // TODO: undefined smells wrong
      PatchError | { message: string }
    >
  > {
    let currentSource = this.drafts[moduleId] || this.sources[moduleId];
    if (!currentSource) {
      const data = await this.api.getTree({
        patch: true,
        treePath: moduleId,
        includeSource: true,
      });
      if (result.isOk(data)) {
        const fetchedSource = data.value.modules[moduleId].source;
        if (fetchedSource !== undefined) {
          currentSource = fetchedSource;
          this.sources[moduleId] = fetchedSource;
          this.drafts[moduleId] = fetchedSource;
          for (const [patchModuleId, patches] of this.patches) {
            if (patchModuleId === moduleId) {
              const res = applyPatch(this.drafts[moduleId], ops, patches);
              // ignores errors - we think that is right, since the patch was submitted at some point so it should be valid.
              if (result.isOk(res)) {
                this.drafts[moduleId] = res.value;
              }
            }
          }
        } else {
          console.error("Val: could not find the module source");
          return result.err({
            message:
              "Val: could not fetch data. Verify that the module exists.",
          });
        }
      } else {
        console.error("Val: failed to get module", data.error);
        return result.err({
          message:
            "Val: could not fetch data. Verify that Val is correctly configured.",
        });
      }
    }
    const res = await this.api.postPatches(moduleId, patch);
    if (result.isErr(res)) {
      console.error("Val: failed to post patch", res.error);
      return res;
    }
    const patchRes = applyPatch(currentSource, ops, patch);
    if (result.isOk(patchRes)) {
      this.patches.push([moduleId, patch]);
      this.drafts[moduleId] = patchRes.value;
      for (const [subscriberId, subscriberModules] of Array.from(
        this.subscribers.entries()
      )) {
        if (subscriberModules[moduleId]) {
          this.subscribers.set(subscriberId, {
            ...subscriberModules,
            [moduleId]: this.drafts[moduleId],
          });
          this.emitChange(subscriberId);
        }
      }

      return result.ok(undefined);
    } else {
      console.error("Val: failed to apply patch", patchRes.error);
      return patchRes;
    }
  }

  async update(moduleIds: ModuleId[]) {
    await Promise.all(moduleIds.map((moduleId) => this.updateTree(moduleId)));
  }

  async reset() {
    await this.updateTree();
  }

  async updateTree(treePath?: string) {
    const data = await this.api.getTree({
      patch: true,
      treePath,
      includeSource: true,
    });
    if (result.isOk(data)) {
      const updatedSubscriberIds = new Map<SubscriberId, ModuleId[]>();
      const subscriberIds = Array.from(this.subscribers.keys());

      // Figure out which modules have been updated and map to updated subscribed id
      for (const moduleId of Object.keys(data.value.modules) as ModuleId[]) {
        const source = data.value.modules[moduleId].source;
        if (typeof source !== "undefined") {
          this.sources[moduleId] = source;
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
      console.log("subscribe", subscriberId);
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
