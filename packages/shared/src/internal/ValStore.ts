import {
  Json,
  ModuleFilePath,
  PatchId,
  SerializedSchema,
  ValApi,
} from "@valbuild/core";
import { result } from "@valbuild/core/fp";
import { Patch, PatchError } from "@valbuild/core/patch";

type SubscriberId = string & {
  readonly _tag: unique symbol;
};

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

  async reloadPaths(paths: ModuleFilePath[]) {
    const patches = await this.api.getPatches({
      omitPatches: true,
      moduleFilePaths: paths,
    });
    if (result.isErr(patches)) {
      console.error("Val: failed to get patches", patches.error);
      return;
    }
    const filteredPatches = Object.keys(patches.value.patches) as PatchId[];
    const data = await this.api.putTree({
      patchIds: filteredPatches,
    });
    await this.initialize();
    if (result.isOk(data)) {
      for (const pathS of Object.keys(data.value.modules)) {
        const path = pathS as ModuleFilePath;
        this.drafts[path] = data.value.modules[path].source;
        this.emitEvent(path, this.drafts[path]);
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
      }
    } else {
      console.error("Val: failed to reload paths", paths, data.error);
    }
  }

  async reset() {
    const patches = await this.api.getPatches();
    if (result.isErr(patches)) {
      console.error("Val: failed to get patches", patches.error);
      return;
    }
    const allPatches = Object.keys(patches.value.patches) as PatchId[];

    const data = await this.api.putTree({
      patchIds: allPatches,
    });
    await this.initialize();
    if (result.isOk(data)) {
      for (const pathS of Object.keys(data.value.modules)) {
        const path = pathS as ModuleFilePath;
        this.drafts[path] = data.value.modules[path].source;
        this.emitEvent(path, this.drafts[path]);
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
      }
    } else {
      console.error("Val: failed to reset", data.error);
    }
  }

  async getModule(path: ModuleFilePath, refetch: boolean = false) {
    if (!refetch && this.drafts[path] && this.schema[path]) {
      return result.ok({
        source: this.drafts[path],
        schema: this.schema[path],
      });
    }
    const data = await this.api.putTree({
      treePath: path,
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
      const schema: SerializedSchema | undefined = this.schema[path];
      if (!this.schema[path]) {
        await this.initialize();
        if (!this.schema[path]) {
          return result.err({
            message: "Path not found in schema. Verify that the module exists.",
          });
        }
      }
      if (fetchedSource !== undefined) {
        this.drafts[path] = fetchedSource;
        return result.ok({
          source: fetchedSource,
          schema,
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
    patchIds: PatchId[],
    patch: Patch
  ): Promise<
    result.Result<
      Record<
        ModuleFilePath,
        {
          patchIds: PatchId[];
        }
      >,
      PatchError | { message: string }
    >
  > {
    const data = await this.api.putTree({
      treePath: path,
      patchIds,
      addPatch: {
        path,
        patch,
      },
    });
    if (result.isOk(data)) {
      const fetchedSource = data.value.modules[path].source;
      if (fetchedSource !== undefined) {
        this.drafts[path] = fetchedSource;
        this.emitEvent(path, fetchedSource);
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
        return result.ok({
          [path]: {
            patchIds: data.value.modules[path].patches?.applied || [],
          },
        });
      } else {
        console.error("Val: could not patch");
        return result.err({
          message: "Val: could not fetch data. Verify that the module exists.",
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

  private emitEvent(path: ModuleFilePath, source: Json) {
    const event = new CustomEvent("val-event", {
      detail: {
        type: "module-update",
        path,
        source,
      },
    });
    window.dispatchEvent(event);
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
    const data = await this.api.getSchema({});
    if (result.isOk(data)) {
      const paths: ModuleFilePath[] = [];
      for (const moduleId of Object.keys(
        data.value.schemas
      ) as ModuleFilePath[]) {
        const schema = data.value.schemas[moduleId];
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
