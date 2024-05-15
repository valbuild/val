import {
  Internal,
  Json,
  ModuleFilePath,
  PatchId,
  SerializedSchema,
  ValApi,
} from "@valbuild/core";
import { result } from "@valbuild/core/fp";
import { JSONOps, Patch, PatchError, applyPatch } from "@valbuild/core/patch";

type SubscriberId = string & {
  readonly _tag: unique symbol;
};

const ops = new JSONOps();

export class ValStore {
  private readonly subscribers: Map<SubscriberId, Record<ModuleFilePath, Json>>; // uncertain whether this is the optimal way of returning
  private readonly listeners: Record<SubscriberId, (() => void)[]>;

  private readonly drafts: Record<ModuleFilePath, Json>;
  private readonly schema: Record<ModuleFilePath, SerializedSchema>;

  constructor(private readonly api: ValApi) {
    this.subscribers = new Map();
    this.listeners = {};
    this.drafts = {};
    this.schema = {};
  }

  async getModule(path: ModuleFilePath, refetch: boolean = false) {
    if (!refetch && this.drafts[path] && this.schema[path]) {
      return result.ok({
        source: this.drafts[path],
        schema: this.schema[path],
      });
    }
    const data = await this.api.getTree({
      patch: true,
      treePath: path,
      includeSource: true,
      includeSchema: true,
    });
    if (result.isOk(data)) {
      if (!data.value.modules[path]) {
        console.error("Val: could not find the module", {
          moduleIds: Object.keys(data.value.modules),
          moduleId: path,
          data,
        });
        return result.err({
          message:
            "Could not fetch data.\nCould not find the module:\n" +
            path +
            "\n\nVerify that the val.modules file includes this module.",
        });
      }
      const fetchedSource = data.value.modules[path].source;
      const fetchedSchema = data.value.modules[path].schema;
      if (fetchedSource !== undefined && fetchedSchema !== undefined) {
        this.drafts[path] = fetchedSource;
        this.schema[path] = fetchedSchema;
        return result.ok({
          source: fetchedSource,
          schema: fetchedSchema,
        });
      } else {
        console.error("Val: could not find the module source");
        return result.err({
          message: "Could not fetch data. Verify that the module exists.",
        });
      }
    } else {
      if (data.error.statusCode === 504) {
        console.error("Val: timeout", data.error);
        return result.err({
          message: "Timed out while fetching data. Try again later.",
        });
      } else {
        console.error("Val: failed to get module", data.error);
        return result.err({
          message:
            "Could not fetch data. Verify that Val is correctly configured.",
        });
      }
    }
  }

  async applyPatch(
    path: ModuleFilePath,
    patch: Patch
  ): Promise<
    result.Result<
      Record<
        ModuleFilePath,
        {
          patch_id: PatchId;
        }
      >,
      PatchError | { message: string }
    >
  > {
    let currentSource = this.drafts[path];
    const currentSchema = this.schema[path];
    if (!currentSource || !currentSchema) {
      const data = await this.api.getTree({
        patch: true,
        treePath: path,
        includeSource: true,
        includeSchema: true,
      });
      if (result.isOk(data)) {
        const fetchedSource = data.value.modules[path].source;
        const fetchedSchema = data.value.modules[path].schema;
        if (fetchedSource !== undefined && fetchedSchema !== undefined) {
          currentSource = fetchedSource;
          this.drafts[path] = fetchedSource;
          this.schema[path] = fetchedSchema;
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

    // TODO: validate client side prior to posting if a (new) validate param is true

    const res = await this.api.postPatches(path, patch);
    if (result.isErr(res)) {
      console.error("Val: failed to post patch", res.error);
      return res;
    }
    const patchRes = applyPatch(
      currentSource,
      ops,
      patch.filter(Internal.notFileOp) // we cannot apply file ops here
    );
    if (result.isOk(patchRes)) {
      this.drafts[path] = patchRes.value;
      this.emitEvent(path, patchRes.value);
      for (const [subscriberId, subscriberModules] of Array.from(
        this.subscribers.entries()
      )) {
        if (subscriberModules[path]) {
          this.subscribers.set(subscriberId, {
            ...subscriberModules,
            [path]: this.drafts[path],
          });
          this.emitChange(subscriberId);
        }
      }
      return res;
    } else {
      console.error("Val: failed to apply patch", patchRes.error);
      return patchRes;
    }
  }

  private emitEvent(path: ModuleFilePath, source: Json) {
    const event = new CustomEvent("val-event", {
      detail: {
        type: "module-update",
        moduleId: path,
        source,
      },
    });
    window.dispatchEvent(event);
  }

  async update(paths: ModuleFilePath[]) {
    await Promise.all(paths.map((moduleId) => this.updateTree(moduleId)));
  }

  async reset() {
    return this.updateTree();
  }

  async initialize(): Promise<
    result.Result<
      ModuleFilePath[],
      {
        message: string;
        details: {
          fetchError: {
            message: string;
            statusCode?: number;
          };
        };
      }
    >
  > {
    const data = await this.api.getTree({
      patch: false,
      includeSource: false,
      includeSchema: true,
    });
    if (result.isOk(data)) {
      const paths: ModuleFilePath[] = [];
      for (const moduleId of Object.keys(
        data.value.modules
      ) as ModuleFilePath[]) {
        const schema = data.value.modules[moduleId].schema;
        if (schema) {
          paths.push(moduleId);
          this.schema[moduleId] = schema;
        }
      }
      return result.ok(paths);
    } else {
      let msg = "Failed to fetch content. ";
      if (data.error.statusCode === 401) {
        msg += "Authorization failed - check that you are logged in.";
      } else {
        msg += "Get a developer to verify that Val is correctly setup.";
      }
      return result.err({
        message: msg,
        details: {
          fetchError: data.error,
        },
      });
    }
  }

  private async updateTree(treePath?: string): Promise<
    result.Result<
      ModuleFilePath[],
      {
        message: string;
        details: {
          fetchError: {
            message: string;
            statusCode?: number;
          };
        };
      }
    >
  > {
    const data = await this.api.getTree({
      patch: true,
      treePath,
      includeSource: true,
      includeSchema: true,
    });
    const paths: ModuleFilePath[] = [];
    if (result.isOk(data)) {
      const updatedSubscriberIds = new Map<SubscriberId, ModuleFilePath[]>();
      const subscriberIds = Array.from(this.subscribers.keys());

      // Figure out which modules have been updated and map to updated subscribed id
      for (const moduleId of Object.keys(
        data.value.modules
      ) as ModuleFilePath[]) {
        const source = data.value.modules[moduleId].source;
        if (typeof source !== "undefined") {
          paths.push(moduleId);
          this.emitEvent(moduleId, source);
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

      return result.ok(paths);
    } else {
      let msg = "Failed to fetch content. ";
      if (data.error.statusCode === 401) {
        msg += "Authorization failed - check that you are logged in.";
      } else {
        msg += "Get a developer to verify that Val is correctly setup.";
      }
      return result.err({
        message: msg,
        details: {
          fetchError: data.error,
        },
      });
    }
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
        1
      );
    };
  };

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

function createSubscriberId(paths: ModuleFilePath[]): SubscriberId {
  return paths.slice().sort().join("&") as SubscriberId;
}
