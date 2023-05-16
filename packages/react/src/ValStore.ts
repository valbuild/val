import { Source, Schema, ValModule, SelectorSource } from "@valbuild/lib";
import { ValApi } from "./ValApi";

export class ValStore {
  private readonly vals: Map<string, ValModule<SelectorSource>>;
  private readonly listeners: { [moduleId: string]: (() => void)[] };

  constructor(private readonly api: ValApi) {
    this.vals = new Map();
    this.listeners = {};
  }

  async updateAll() {
    console.log();
    await Promise.all(
      Object.keys(this.listeners).map(async (moduleId) => {
        console.log(await this.api.getModule(moduleId));
        this.set(
          moduleId,
          await this.api.getModule(moduleId)
          // ModuleContent.deserialize(await this.api.getModule(moduleId))
        );
      })
    );
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

  emitChange(moduleId: string) {
    const listeners = this.listeners[moduleId];
    if (typeof listeners === "undefined") return;
    for (const listener of listeners) {
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
