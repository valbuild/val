import type { ModuleFilePath, PatchId } from "@valbuild/core";
import type { Patch } from "@valbuild/core/patch";
import type { System } from "../createSystem";
import type { UploadProgress } from "../PatchStore";

export type WritePatchResult =
  | { status: "ok"; patchId: PatchId }
  | { status: "error"; message: string };

/**
 * Write a patch from a field: what every field's `addPatch`,
 * `addModuleFilePatch` and `addAndUploadPatchWithFileOps` come down to
 * (`useAddPatch`). A patch with `file` ops uploads its bytes first, through
 * the system's `uploadFile`; `onProgress` hears about it.
 *
 * Its own function, out of the hook, so the scenario harness (`scenarios/`)
 * writes exactly what a field writes.
 */
export async function writePatch(
  system: System,
  target: ModuleFilePath,
  patch: Patch,
  options: {
    /** The field instance writing, left asleep when the patch lands. */
    creatorId?: string;
    onProgress?: UploadProgress;
    fileType?: "image" | "file";
  } = {},
): Promise<WritePatchResult> {
  const res = await system.patchStore.createPatch(
    target,
    patch,
    undefined,
    options.creatorId,
    options.onProgress,
    undefined,
    undefined,
    options.fileType,
  );
  if (res.status !== "created") {
    return { status: "error", message: res.message };
  }
  return { status: "ok", patchId: res.record.patchId };
}
