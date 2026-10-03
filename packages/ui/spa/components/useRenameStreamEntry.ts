import { useCallback } from "react";
import { Internal, SerializedVideoSchema, SourcePath } from "@valbuild/core";
import { useAddPatch, useSchemas } from "./ValFieldProvider";
import { useValSystem } from "../stores/react/SystemContext";
import { jsonValuesLoadRequirements } from "./jsonValuesLoadRequirements";
import { loadForReferenceScan } from "./loadForReferenceScan";
import { getFileReferrers } from "./getReferencedFiles";
import type { RenameMediaResult } from "./useRenameMediaFile";
import {
  buildStreamEntryRenamePatches,
  readStream,
  type StreamReferrer,
} from "../utils/video/renameVideo";
import { fetchStreamFile } from "../utils/video/fetchStreamFile";

/**
 * Rename an HLS stream that is an entry of the `s.videoset()` this hook is
 * mounted for, and point every `s.video(set)` field using it at the new name.
 *
 * The stream counterpart of `useRenameMediaFile`'s gallery entry, in the same
 * order and for the same reasons: a complete reference scan first, the set's
 * own patch (which carries the upload) next, and the referrers only after it
 * has landed.
 */
export function useRenameStreamEntry(
  path: SourcePath,
): (request: {
  key: string;
  newBase: string;
  url: string;
  existingKeys: readonly string[];
  schema: SerializedVideoSchema;
}) => Promise<RenameMediaResult> {
  const schemas = useSchemas();
  const val = useValSystem();
  const { patchPath, writeModulePatch } = useAddPatch(path);
  return useCallback(
    async (request) => {
      if (val === null) {
        return {
          status: "error",
          message: "Cannot rename: no store system is mounted.",
        };
      }
      if (schemas.status !== "success") {
        return {
          status: "error",
          message: "Cannot rename before the schemas have loaded.",
        };
      }
      const [moduleFilePath] = Internal.splitModuleFilePathAndModulePath(path);
      const { sourceStore, patchStore } = val.system;
      const loaded = await loadForReferenceScan(
        sourceStore,
        jsonValuesLoadRequirements(schemas.data, {
          kind: "file",
          module: moduleFilePath,
        }),
        "use this video",
      );
      if (loaded.status === "error") {
        return { status: "error", message: loaded.message };
      }
      const filePatchIds = patchStore.filePatchIds();
      const referrers: StreamReferrer[] = [];
      for (const referrer of getFileReferrers(
        schemas.data,
        sourceStore.allSources(),
        moduleFilePath,
        request.key,
      )) {
        if (referrer.path !== null) {
          referrers.push({
            sourcePath: referrer.sourcePath,
            hasPatchId: referrer.hasPatchId || filePatchIds.has(referrer.path),
          });
        }
      }
      let files;
      try {
        files = await readStream(
          request.key,
          request.url,
          fetchStreamFile,
          window.location.href,
        );
      } catch (err) {
        return {
          status: "error",
          message: err instanceof Error ? err.message : String(err),
        };
      }
      const built = buildStreamEntryRenamePatches({
        setPatchPath: patchPath,
        key: request.key,
        existingKeys: request.existingKeys,
        newBase: request.newBase,
        files,
        schema: request.schema,
        sha256: Internal.getSHA256Hash,
        referrers,
      });
      if (built.status !== "ok") {
        return built;
      }
      const written = await writeModulePatch(moduleFilePath, built.primary, {
        fileType: "file",
      });
      if (written.status === "error") {
        return written;
      }
      const failed: string[] = [];
      for (const referrer of built.referrers) {
        const res = await writeModulePatch(
          referrer.moduleFilePath,
          referrer.patch,
          { fileType: "file" },
        );
        if (res.status === "error") {
          failed.push(`${referrer.moduleFilePath}: ${res.message}`);
        }
      }
      if (failed.length > 0) {
        return {
          status: "partial",
          newPath: built.newPath,
          message: `Renamed, but these could not be updated to the new name: ${failed.join("; ")}`,
        };
      }
      return { status: "ok", newPath: built.newPath };
    },
    [val, schemas, path, patchPath, writeModulePatch],
  );
}
