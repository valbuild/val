import {
  ValModule,
  SelectorSource,
  SerializedVal,
  SourcePath,
  ModuleId,
  ModulePath,
  SerializedSchema,
} from "@valbuild/core";
import {
  BranchRef,
  CommitSha,
  OrgName,
  ProjectName,
} from "@valbuild/core/internal";
import { Patch } from "@valbuild/core/patch";
import { Json } from "@valbuild/core/src/Json";
import { SerializedArraySchema } from "@valbuild/core/src/schema/array";
import { SerializedObjectSchema } from "@valbuild/core/src/schema/object";
import { ValApi } from "./ValApi";

export function initStore(config: {
  api: ValApi;
  commitSha: CommitSha;
  branchRef: BranchRef;
  projectName: ProjectName;
  orgName: OrgName;
}) {
  return new ValStore(config.api);
}

type RootModule =
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

export class ValStore {
  private readonly vals: Map<ModuleId, Json>;
  private readonly listeners: { [path: SourcePath]: (() => void)[] };

  constructor(private readonly api: ValApi) {
    this.vals = new Map();
    this.listeners = {};
  }

  subscribe = (moduleId: string) => (listener: () => void) => {
    const listeners = (this.listeners[moduleId] =
      moduleId in this.listeners ? this.listeners[moduleId] : []);
    listeners.push(listener);
    return () => {
      listeners.splice(listeners.indexOf(listener), 1);
      if (listeners.length === 0) {
        delete this.listeners[moduleId];
      }
    };
  };

  set(moduleId: string, val: ValModule<SelectorSource>) {
    this.vals.set(moduleId, val);
    this.emitChange(moduleId);
  }

  get(moduleId: string) {
    return this.vals.get(moduleId);
  }

  emitChange(sourcePath: SourcePath) {
    const listeners = this.listeners[moduleId];
    if (typeof listeners === "undefined") return;
    for (const listener of listeners) {
      listener();
    }
  }

  getSnapshot = (sourcePath: SourcePath) => () => {
    return this.vals.get(moduleId);
  };

  getServerSnapshot = (sourcePath: SourcePath) => () => {
    return this.vals.get(moduleId);
  };

  getRootModules() {
    // { [moduleId: string]:  }
  }

  fetchVal(
    sourcePath: SourcePath,
    applyPatches = true
  ): Promise<SerializedVal> {
    throw new Error("Method not implemented.");
  }

  applyPatch(sourcePath: SourcePath, patch: Patch): Promise<void> {
    throw new Error("Method not implemented.");
  }

  getValidationErrors() {
    // TODO?
  }
}
