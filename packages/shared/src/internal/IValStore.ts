import { Json, ModuleId, PatchId, SerializedSchema } from "@valbuild/core";
import { result } from "@valbuild/core/src/fp";
import { Patch, PatchError } from "@valbuild/core/src/patch";

export interface IValStore {
  reset(): Promise<void>;
  update(moduleIds: ModuleId[]): Promise<void>;
  getModule(
    moduleId: ModuleId,
    refetch: boolean
  ): Promise<
    result.Result<
      {
        source: Json;
        schema: SerializedSchema;
      },
      PatchError
    >
  >;
  applyPatch(
    moduleId: ModuleId,
    patch: Patch
  ): Promise<
    result.Result<
      Record<
        ModuleId,
        {
          patch_id: PatchId;
        }
      >,
      PatchError
    >
  >;
}
