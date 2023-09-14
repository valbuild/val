import { Json, ModuleId } from "@valbuild/core";
import { ValApi } from "./ValApi";
import { result } from "@valbuild/core/fp";

export class ValStore {
  private readonly vals: Map<ModuleId, Json>;
  private readonly listeners: (() => void)[];

  constructor(private readonly api: ValApi) {
    this.vals = new Map();
    this.listeners = [];
  }

  async updateAll() {
    const data = await this.api.getModules({
      patch: true,
      includeSource: true,
    });
    if (result.isOk(data)) {
      for (const moduleId of Object.keys(data.value.modules) as ModuleId[]) {
        const source = data.value.modules[moduleId].source;
        if (typeof source !== "undefined") {
          this.vals.set(moduleId, source);
        }
      }
      this.emitChange();
    } else {
      console.error(data.error.message);
    }
  }

  subscribe = () => (listener: () => void) => {
    this.listeners.push(listener);
    return () => {
      this.listeners.splice(this.listeners.indexOf(listener), 1);
    };
  };

  emitChange() {
    for (const listener of this.listeners) {
      listener();
    }
  }

  getSnapshot = () => () => {
    // return this.vals.get(moduleId);
  };

  getServerSnapshot = () => () => {
    // return this.vals.get(moduleId);
  };
}
