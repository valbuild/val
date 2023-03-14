import { SerializedModuleContent } from "@valbuild/lib";
import { ValApi } from "./ValApi";

export class ValStore {
  private readonly vals: Map<string, SerializedModuleContent>;
  private listeners: (() => void)[];
  private readonly subscribedModulesIds: { [moduleId: string]: number };

  constructor(private readonly api: ValApi) {
    this.vals = new Map();
    this.listeners = [];
    this.subscribedModulesIds = {};
  }

  async updateAll() {
    await Promise.all(
      Object.keys(this.subscribedModulesIds).map(async (moduleId) => {
        this.vals.set(moduleId, await this.api.getModule(moduleId));
      })
    );
    this.emitChange();
  }

  subscribe = (moduleId: string) => (listener: () => void) => {
    this.listeners = [...this.listeners, listener];
    this.subscribedModulesIds[moduleId] =
      (this.subscribedModulesIds[moduleId] || 0) + 1;
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
      if (this.subscribedModulesIds[moduleId] !== undefined) {
        this.subscribedModulesIds[moduleId] -= 1;
        if (this.subscribedModulesIds[moduleId] <= 0) {
          delete this.subscribedModulesIds[moduleId];
        }
      }
    };
  };

  set(id: string, val: SerializedModuleContent) {
    this.vals.set(id, val);
  }

  get(moduleId: string) {
    return this.vals.get(moduleId);
  }

  emitChange() {
    for (const listener of this.listeners) {
      listener();
    }
  }

  getSnapshot = (moduleId: string) => () => {
    return this.vals.get(moduleId);
  };

  getServerSnapshot = (moduleId: string) => () => {
    return this.vals.get(moduleId);
  };
}
