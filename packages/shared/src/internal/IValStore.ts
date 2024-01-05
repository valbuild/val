import { ModuleId } from "@valbuild/core";

export interface IValStore {
  updateAll(): Promise<void>;
  update(moduleIds: ModuleId[]): Promise<void>;
}
