import { ModuleId } from "@valbuild/core";
import { result } from "@valbuild/core/src/fp";
import { Patch, PatchError } from "@valbuild/core/src/patch";

export interface IValStore {
  reset(): Promise<void>;
  update(moduleIds: ModuleId[]): Promise<void>;
  applyPatch(
    moduleId: ModuleId,
    patch: Patch
  ): Promise<result.Result<undefined, PatchError>>;
}
