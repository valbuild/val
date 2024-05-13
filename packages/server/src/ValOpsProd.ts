import { PatchId, ModuleId } from "@valbuild/core";
import { Patch, PatchError } from "@valbuild/core/patch";
import { GenericError, OpsMetadata, ValOps } from "./ValOps";

export class ValOpsProd extends ValOps {
  getPatchesById(
    patchIds: PatchId[]
  ): Promise<{
    [patchId: PatchId]:
      | GenericError
      | { path: ModuleId; patch: Patch; error?: undefined };
  }> {
    throw new Error("Method not implemented.");
  }
  protected saveSourceFilePatch(
    path: ModuleId,
    patch: Patch
  ): Promise<{ patchId: PatchId; error?: undefined } | GenericError> {
    throw new Error("Method not implemented.");
  }
  protected deletePatches(
    patchIds: PatchId[]
  ): Promise<
    | { patchIds: PatchId[]; errors?: undefined }
    | { errors: { message: string; patchId: PatchId }[] }
  > {
    throw new Error("Method not implemented.");
  }
  protected getSourceFile(
    path: ModuleId
  ): Promise<GenericError | { data: string; error?: undefined }> {
    throw new Error("Method not implemented.");
  }
  protected saveSourceFile(
    path: ModuleId,
    data: string
  ): Promise<GenericError | { path: ModuleId; error?: undefined }> {
    throw new Error("Method not implemented.");
  }
  protected getPatchBase64File(
    filePath: string,
    patchId: PatchId
  ): Promise<GenericError | { data: string; error?: undefined }> {
    throw new Error("Method not implemented.");
  }
  protected savePatchBase64File(
    filePath: string,
    patchId: PatchId,
    data: string,
    sha256: string
  ): Promise<
    GenericError | { patchId: PatchId; filePath: string; error?: undefined }
  > {
    throw new Error("Method not implemented.");
  }
  protected getPatchBase64FileMetadata(
    filePath: string,
    type: "file" | "image",
    fields: string[],
    patchId: PatchId
  ): Promise<OpsMetadata> {
    throw new Error("Method not implemented.");
  }
  protected getBinaryFileMetadata(
    filePath: string,
    type: "file" | "image",
    fields: string[]
  ): Promise<OpsMetadata> {
    throw new Error("Method not implemented.");
  }
}
