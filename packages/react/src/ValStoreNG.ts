import {
  ModuleId,
  ModulePath,
  SerializedModule,
  SerializedSchema,
  SerializedVal,
} from "@valbuild/core";
import {
  BranchRef,
  CommitSha,
  OrgName,
  ProjectName,
  PatchId,
} from "@valbuild/core/internal";
import { JSONValue, Patch } from "@valbuild/core/patch";
import { SerializedArraySchema } from "@valbuild/core/src/schema/array";
import { SerializedObjectSchema } from "@valbuild/core/src/schema/object";

export type PatchError = {
  patch_id: PatchId;
  error: {
    message: string;
  };
};

type Request<T> =
  | {
      status: "requested";
    }
  | {
      status: "error";
      error: string;
    }
  | {
      status: "ready";
      data: T;
    };
declare const brand: unique symbol;
type DateString = string & {
  [brand]: "DateString";
};
type PatchData = {
  module_id: ModuleId;
  author: {
    image_url?: string;
    username?: string;
    email: string;
  };
  updated_at: DateString;
  ops: Patch;
  // TODO: postPatchValHash: string; // used to check if the application of the patch was valid
};

type PathOp =
  | {
      op: "add";
      value: JSONValue;
    }
  | {
      op: "remove";
    }
  | {
      op: "replace";
      value: JSONValue;
    }
  | {
      op: "move";
      from: string;
    }
  | {
      op: "copy";
      from: string;
    }
  | {
      op: "test";
      path: string;
    };

type ProjectState = { org: OrgName; project: ProjectName };

type GitState =
  | { mode: "proxy"; branch: BranchRef; head: CommitSha }
  | { mode: "local"; branch?: BranchRef; head?: CommitSha };

type Deployment = {
  commitSha: CommitSha;
  created_at: DateString;
  updated_at: DateString;
  completes_at?: DateString;
  completed_at?: DateString;
  status: "committed" | "building" | "failed" | "unknown";
};

type RootModules =
  | {
      compositeType: "object";
      schema: SerializedObjectSchema;
      paths: ModulePath[];
      size: number;
    }
  // | {
  //     compositeType: "record";
  //     schema: SerializedRecordSchema;
  //     paths: ModulePath[];
  //     size: number;
  //   }
  | {
      compositeType: "array";
      schema: SerializedArraySchema;
      paths: ModulePath[];
      size: number;
    }
  | {
      compositeType: false;
      schema: SerializedSchema;
      source: SerializedVal;
    };

// TODO: replace ValApi with this

type StateOptions = {
  maxSize: number;
} & (
  | {
      patchIds?: PatchId[]; // if omitted: we consider all patches
      branch: BranchRef;
    }
  | {
      patchIds?: undefined;
    }
);
class ValApiNG {
  constructor(private readonly projectState: ProjectState) {
    //
  }

  async getInitState(options: StateOptions): Promise<{
    modules: {
      [moduleId: ModuleId]: {
        root_modules: RootModules;
        applied_patches: PatchId[];
        failed_patches: PatchError[];
        failed_validations: {
          [modulePath: ModulePath]: {
            message: string;
            // TODO: details, line, column, ...?
          };
        };
      };
    };
  }> {
    throw Error("TODO");
  }

  async getPatch(patchId: PatchId): Promise<PatchData> {
    throw Error("TODO");
  }

  async postPatch(moduleId: ModuleId, patch: Patch): Promise<PatchId> {
    throw Error("TODO");
  }

  async getModule(moduleId: ModuleId): Promise<SerializedModule> {
    throw Error("TODO");
  }

  async getModuleAtPath(
    moduleId: ModuleId,
    paths: ModulePath[]
  ): Promise<SerializedModule> {
    throw Error("TODO");
  }

  // TODO:
  async getDeployments(branch: BranchRef): Promise<{
    currentHead: CommitSha;
    deployments: Deployment[];
  }> {
    throw Error("TODO");
  }
}

type ValStoreState =
  | { status: "not-asked" }
  | { status: "requested"; gitState: GitState }
  | { status: "error"; gitState: GitState; error: string }
  | {
      status: "ready";
      gitState: GitState;
      moduleIds: ModuleId[];
      // Lazily loaded when requested:
      appliedPatches: Map<ModuleId, Request<PatchId[]>>;
      failedPatches: Map<ModuleId, Request<PatchError[]>>;
      failedValidations: Map<ModuleId, Map<ModulePath, { message: string }>>;

      //
      ops: Map<ModuleId, Map<ModulePath, PathOp[]>>;
      modules: Map<ModuleId, Request<SerializedModule>>;
    };

class ValStoreStorage {
  // TODO: does this work?
  getDraftPatches(
    moduleIds: ModuleId[]
  ): Map<ModuleId, Map<ModulePath, PathOp>> {
    const draftPatches = new Map();
    for (const moduleId of moduleIds) {
      const storedDraftPatch = localStorage.getItem(`draftPatches:${moduleId}`);
      if (storedDraftPatch !== null) {
        const ops = new Map<ModulePath, PathOp>();
        for (const [path, draftOp] of JSON.parse(storedDraftPatch)) {
          if (
            typeof path === "string" &&
            path.startsWith("/") &&
            typeof draftOp === "object"
          ) {
            ops.set(path as ModulePath, draftOp as PathOp);
          }
        }
        draftPatches.set(moduleId, ops);
      }
    }
    return draftPatches;
  }

  // TODO: does this work?
  setDraftPatch(moduleId: ModuleId, path: ModulePath, draftOp: PathOp): void {
    const draftPatches = this.getDraftPatches([moduleId]);
    const ops = draftPatches.get(moduleId) || new Map();
    ops.set(path, draftOp);
    draftPatches.set(moduleId, ops);
    localStorage.setItem(
      `draftPatches:${moduleId}`,
      JSON.stringify(ops.entries())
    );
  }
}

export class ValStore {
  private state: ValStoreState;
  private readonly storage: ValStoreStorage = new ValStoreStorage();
  private readonly api: ValApiNG;

  private modulePathListeners: {
    [moduleId: ModuleId]: {
      [modulePath: ModulePath]: (() => void)[];
    };
  };
  private moduleListeners: {
    [moduleId: ModuleId]: (() => void)[];
  };

  constructor(
    private readonly projectState: ProjectState,
    private readonly proxy: boolean
  ) {
    this.state = {
      status: "not-asked",
    };
    this.api = new ValApiNG(projectState);
    this.modulePathListeners = {};
    this.moduleListeners = {};
  }

  async init(gitState: GitState) {
    this.state = {
      status: "requested",
      gitState,
    };
    try {
      const initData = await this.api.getInitState({
        maxSize: 50,
      });
      const moduleIds = Object.keys(initData) as ModuleId[];
      const appliedPatches = new Map<ModuleId, Request<PatchId[]>>();
      const failedPatches = new Map<ModuleId, Request<PatchError[]>>();
      for (const moduleId of moduleIds) {
        const { applied_patches, failed_patches, failed_validations } =
          initData.modules[moduleId];
        appliedPatches.set(moduleId, {
          status: "ready",
          data: applied_patches,
        });
        failedPatches.set(moduleId, { status: "ready", data: failed_patches });
      }
      this.state = {
        status: "ready",
        gitState,
        moduleIds,
        appliedPatches,
        failedPatches,
        ops: this.storage.getDraftPatches(moduleIds),
        modules: new Map(),
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : JSON.stringify(e);
      this.state = {
        status: "error",
        gitState,
        error: message,
      };
    }
  }

  getModule(moduleId: ModuleId): Request<SerializedModule> {
    if (this.state.status !== "ready") {
      throw Error("ValStore not ready");
    }
    const module = this.state.modules.get(moduleId);
    if (module !== undefined && module.status === "ready") {
      return module;
    }
    if (module === undefined || module.status !== "requested") {
      this.state.modules.set(moduleId, { status: "requested" });
      this.emitModuleChange(moduleId);
      const gitState = this.state.gitState;
      this.api.getModule(moduleId).then((moduleData) => {
        if (this.state.status !== "ready") {
          return {
            status: "error",
            data: moduleData,
            error: `Val store no longer ready`,
          };
        }
        if (this.state.gitState.head !== gitState.head) {
          return {
            status: "error",
            data: moduleData,
            error: `Val store git state has changed? Expected: ${gitState.head} but got: ${this.state.gitState.head}`,
          };
        }
        this.state.modules.set(moduleId, {
          status: "ready",
          data: moduleData,
        });
        this.emitModuleChange(moduleId);
      });
      return { status: "requested" };
    }
    return module;
  }

  applyPatch(moduleId: ModuleId, patch: Patch) {
    // add to draft
  }

  emitModuleChange(moduleId: ModuleId) {
    const listeners = this.moduleListeners[moduleId];
    if (typeof listeners === "undefined") return;
    for (const listener of listeners) {
      listener();
    }

    // all paths under this module
    const pathListeners = this.modulePathListeners[moduleId];
    if (typeof pathListeners === "undefined") return;
    for (const listeners of Object.values(pathListeners)) {
      for (const listener of listeners) {
        listener();
      }
    }
  }

  emitModulePathChange(moduleId: ModuleId, modulePath: ModulePath) {
    const listeners = this.modulePathListeners[moduleId][modulePath];
    for (const listener of listeners) {
      listener();
    }
  }

  subscribeModule = (moduleId: ModuleId) => (listener: () => void) => {
    if (!this.moduleListeners[moduleId]) {
      this.moduleListeners[moduleId] = [];
    }
    const listeners = this.moduleListeners[moduleId];
    listeners.push(listener);
    return () => {
      listeners.splice(listeners.indexOf(listener), 1);
      if (listeners.length === 0) {
        delete this.moduleListeners[moduleId];
      }
    };
  };

  subscribeModulePath =
    (moduleId: ModuleId, modulePath: ModulePath) => (listener: () => void) => {
      if (!this.modulePathListeners[moduleId]) {
        this.modulePathListeners[moduleId] = {};
      }
      if (!this.modulePathListeners[moduleId][modulePath]) {
        this.modulePathListeners[moduleId][modulePath] = [];
      }
      const listeners = this.modulePathListeners[moduleId][modulePath];
      listeners.push(listener);
      return () => {
        listeners.splice(listeners.indexOf(listener), 1);
        if (listeners.length === 0) {
          delete this.modulePathListeners[moduleId][modulePath];
        }
      };
    };
}
