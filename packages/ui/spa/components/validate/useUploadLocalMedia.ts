import { useCallback } from "react";
import {
  Internal,
  Json,
  ModuleFilePath,
  ModulePath,
  PatchId,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";
import { useSchemas } from "../ValFieldProvider";
import {
  useCurrentRemoteFileBucket,
  useRemoteFiles,
  useRemoteHost,
} from "../ValRemoteProvider";
import { useValSystem } from "../../stores/react/SystemContext";
import type { SourceStore } from "../../stores/SourceStore";
import { jsonValuesLoadRequirements } from "../jsonValuesLoadRequirements";
import { loadForReferenceScan } from "../loadForReferenceScan";
import { getFileReferrers } from "../getReferencedFiles";
import { fetchMediaBytes } from "../../utils/fetchMediaBytes";
import { mediaUrlOf } from "../../utils/mediaUrl";
import type { MediaReferrer } from "../../utils/renameMediaFile";
import {
  buildLocalMediaUploadPatches,
  LocalMediaUploadTarget,
  RemoteUploadSettings,
  StudioUploadFix,
} from "../../utils/uploadLocalMedia";

export type UploadLocalMediaResult =
  | {
      status: "ok";
      /** Every patch written, the gallery's first: what Undo removes. */
      patchIds: PatchId[];
      summary: string;
    }
  | {
      status: "error";
      message: string;
      /** Whether pressing Fix again can help. */
      retry: boolean;
    };

/**
 * The Validate page's **Fix** for a local file in a project with remote files
 * (`*:upload-remote`): the file goes up the way any Studio upload does. The
 * rules are in `uploadLocalMedia.ts`; this is the part that talks to the
 * stores, in the order `useRenameMediaFile` does it:
 *
 * 1. **Load what the reference scan needs** (a gallery entry only), and refuse
 *    if it cannot be complete: a rename on a partial scan leaves fields naming
 *    an entry that no longer exists.
 * 2. **Read the bytes** back from where the Studio shows them.
 * 3. **Write the gallery's or the field's own patch, and wait for it.** It
 *    carries the upload, so it is the step that can fail; nothing else is
 *    written if it does.
 * 4. **Point the fields that picked the entry at the ref**, one patch per
 *    module, only after (3) landed.
 */
export function useUploadLocalMedia(): (
  sourcePath: SourcePath,
  fix: StudioUploadFix,
) => Promise<UploadLocalMediaResult> {
  const schemas = useSchemas();
  const val = useValSystem();
  const remoteFiles = useRemoteFiles();
  const bucket = useCurrentRemoteFileBucket();
  const remoteHost = useRemoteHost();
  return useCallback(
    async (sourcePath, fix) => {
      if (val === null) {
        return {
          status: "error",
          message: "Cannot upload: no store system is mounted.",
          retry: false,
        };
      }
      if (schemas.status !== "success") {
        return {
          status: "error",
          message: "The schemas have not loaded yet, so nothing was uploaded.",
          retry: true,
        };
      }
      if (remoteFiles.status !== "ready" || bucket === null) {
        return {
          status: "error",
          message:
            remoteFiles.status === "inactive"
              ? "Val Build could not say where to upload files for this project, so nothing was uploaded."
              : "Uploads are still being prepared, so nothing was uploaded.",
          retry: true,
        };
      }
      const remote: RemoteUploadSettings = {
        publicProjectId: remoteFiles.publicProjectId,
        bucket,
        coreVersion: remoteFiles.coreVersion,
        remoteHost,
      };
      const { sourceStore, patchStore } = val.system;
      const filePatchIds = patchStore.filePatchIds();
      let target: Awaited<ReturnType<typeof targetOf>>;
      try {
        target = await targetOf(
          sourcePath,
          fix,
          schemas.data,
          sourceStore,
          filePatchIds,
        );
      } catch {
        // `resolvePath` throws for a path the content no longer has.
        target = {
          status: "error",
          message: "This file is no longer there. Check the module again.",
        };
      }
      if (target.status === "error") {
        return { ...target, retry: false };
      }
      const localPath =
        target.target.kind === "field"
          ? target.target.value.path
          : target.target.key;
      const url = mediaUrlOf(localPath, filePatchIds);
      const filename = localPath.slice(localPath.lastIndexOf("/") + 1);
      if (url === null) {
        return {
          status: "error",
          message: `Val does not know where ${filename} is served from, so nothing was uploaded.`,
          retry: false,
        };
      }
      const mimeType =
        target.target.kind === "field"
          ? target.target.value.mimeType
          : target.target.entry.mimeType;
      const fetched = await fetchMediaBytes(
        url,
        filename,
        typeof mimeType === "string" ? mimeType : undefined,
      );
      if (fetched.status === "error") {
        return {
          status: "error",
          message: `${fetched.message} Nothing was uploaded.`,
          retry: true,
        };
      }
      const built = buildLocalMediaUploadPatches({
        target: target.target,
        bytes: fetched.bytes,
        remote,
      });
      if (built.status === "error") {
        return { ...built, retry: false };
      }
      const fileType =
        fix === "file:upload-remote" || fix === "files:upload-remote"
          ? "file"
          : "image";
      const { primary, referrers } = built.patches;
      const written = await patchStore.createPatch(
        primary.moduleFilePath,
        primary.patch,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        fileType,
      );
      if (written.status !== "created") {
        return {
          status: "error",
          message: `The file could not be uploaded, so nothing was changed: ${written.message}`,
          retry: true,
        };
      }
      const patchIds: PatchId[] = [written.record.patchId];
      const failed: string[] = [];
      for (const referrer of referrers) {
        const res = await patchStore.createPatch(
          referrer.moduleFilePath,
          referrer.patch,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          fileType,
        );
        if (res.status === "created") {
          patchIds.push(res.record.patchId);
        } else {
          failed.push(`${referrer.moduleFilePath}: ${res.message}`);
        }
      }
      if (failed.length > 0) {
        // The file IS uploaded at this point, so this is not a refusal: it is
        // the list of fields still naming the local file, for someone to fix.
        return {
          status: "ok",
          patchIds,
          summary: `Uploaded ${filename}, but these still name the local file: ${failed.join("; ")}`,
        };
      }
      const using =
        referrers.length > 0
          ? `, and pointed ${referrers.length} ${referrers.length === 1 ? "module" : "modules"} using it at the upload`
          : "";
      return {
        status: "ok",
        patchIds,
        summary: `Uploads ${filename} when published${using}.`,
      };
    },
    [val, schemas, remoteFiles, bucket, remoteHost],
  );
}

async function targetOf(
  sourcePath: SourcePath,
  fix: StudioUploadFix,
  schemas: Record<ModuleFilePath, SerializedSchema>,
  sourceStore: SourceStore,
  filePatchIds: ReadonlyMap<string, string>,
): Promise<
  | { status: "ok"; target: LocalMediaUploadTarget }
  | { status: "error"; message: string }
> {
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(sourcePath);
  const moduleSchema = schemas[moduleFilePath];
  const moduleSource = sourceStore.moduleSource(moduleFilePath);
  if (moduleSchema === undefined || moduleSource === undefined) {
    return {
      status: "error",
      message: `${moduleFilePath} is not loaded, so nothing was uploaded.`,
    };
  }
  if (fix === "image:upload-remote" || fix === "file:upload-remote") {
    const resolved = Internal.resolvePath(
      modulePath,
      moduleSource,
      moduleSchema,
    );
    const value = resolved.source;
    if (
      (resolved.schema.type !== "image" && resolved.schema.type !== "file") ||
      !isJsonObject(value) ||
      typeof value.path !== "string"
    ) {
      return {
        status: "error",
        message: "This is no longer a local file. Check the module again.",
      };
    }
    return {
      status: "ok",
      target: {
        kind: "field",
        moduleFilePath,
        patchPath: Internal.createPatchPath(modulePath),
        schema: resolved.schema,
        value: { ...value, path: value.path },
      },
    };
  }

  // A gallery entry: its key is the last segment of its path.
  const segments = modulePath ? Internal.splitModulePath(modulePath) : [];
  const key = segments[segments.length - 1];
  const [, recordModulePath] = Internal.splitModuleFilePathAndModulePath(
    Internal.parentOfSourcePath(sourcePath),
  );
  const record = Internal.resolvePath(
    recordModulePath as ModulePath,
    moduleSource,
    moduleSchema,
  );
  const entries = record.source;
  const entry =
    isJsonObject(entries) && key !== undefined ? entries[key] : undefined;
  if (
    key === undefined ||
    record.schema.type !== "record" ||
    !isJsonObject(entries) ||
    !isJsonObject(entry)
  ) {
    return {
      status: "error",
      message:
        "This entry is no longer in the gallery. Check the module again.",
    };
  }
  const loaded = await loadForReferenceScan(
    sourceStore,
    jsonValuesLoadRequirements(schemas, {
      kind: "file",
      module: moduleFilePath,
    }),
    "upload this file",
  );
  if (loaded.status === "error") {
    return { status: "error", message: loaded.message };
  }
  const referrers: MediaReferrer[] = [];
  for (const referrer of getFileReferrers(
    schemas,
    sourceStore.allSources(),
    moduleFilePath,
    key,
  )) {
    if (referrer.path !== null) {
      referrers.push({
        sourcePath: referrer.sourcePath,
        path: referrer.path,
        hasPatchId: referrer.hasPatchId || filePatchIds.has(referrer.path),
      });
    }
  }
  return {
    status: "ok",
    target: {
      kind: "gallery-entry",
      moduleFilePath,
      patchPath: recordModulePath
        ? Internal.createPatchPath(recordModulePath as ModulePath)
        : [],
      key,
      record: record.schema,
      entry,
      existingKeys: Object.keys(entries),
      referrers,
    },
  };
}

function isJsonObject(value: unknown): value is { [key: string]: Json } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
