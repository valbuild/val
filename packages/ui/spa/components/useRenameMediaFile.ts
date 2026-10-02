import { useCallback } from "react";
import {
  FileMetadata,
  ImageMetadata,
  Internal,
  Json,
  JsonObject,
  SourcePath,
} from "@valbuild/core";
import { useAddPatch, useSchemas } from "./ValFieldProvider";
import { useValSystem } from "../stores/react/SystemContext";
import { jsonValuesLoadRequirements } from "./jsonValuesLoadRequirements";
import { loadForReferenceScan } from "./loadForReferenceScan";
import { getFileReferrers } from "./getReferencedFiles";
import {
  MediaBytes,
  MediaReferrer,
  MediaRenameTarget,
  buildMediaRenamePatches,
  planMediaRename,
} from "../utils/renameMediaFile";
import { fetchMediaBytes } from "../utils/fetchMediaBytes";

export type RenameMediaRequest = {
  /** What the person typed: the name without the hash suffix or extension. */
  newBase: string;
  /** What Val recorded about the file; carried by the re-upload's `file` op. */
  metadata: ImageMetadata | FileMetadata | undefined;
  fileType: "image" | "file";
} & (
  | {
      /** An entry of the gallery this hook was mounted for. */
      kind: "gallery-entry";
      key: string;
    }
  | {
      /** The `s.image()` / `s.file()` field this hook was mounted for. */
      kind: "field";
      /** The field's `path` as it is now. */
      path: string;
    }
);

export type RenameMediaResult =
  | { status: "ok"; newPath: string }
  | { status: "unchanged" }
  | { status: "error"; message: string };

/**
 * Rename a media file — a gallery entry, or the file of a standalone field —
 * and rewrite everything that names it.
 *
 * `path` is where the hook is mounted: the gallery module, or the field.
 *
 * The rules are in `renameMediaFile.ts`; this is the part that has to talk to
 * the stores, in this order:
 *
 * 1. **Load what the reference scan needs**, and refuse if it cannot be
 *    complete. A rename on a partial scan leaves fields pointing at a file
 *    that no longer exists — see `loadForReferenceScan`.
 * 2. **Scan** for the fields pointing at the entry, rich text images included.
 * 3. **Read the bytes** if they have to move (local files, and remote drafts).
 * 4. **Write the gallery's or the field's own patch, and wait for it.** It
 *    carries the upload, so it is the step that can fail; nothing else is
 *    written if it does.
 * 5. **Rewrite the referrers**, one patch per module, only after (4) landed.
 */
export function useRenameMediaFile(
  path: SourcePath,
): (request: RenameMediaRequest) => Promise<RenameMediaResult> {
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

      let target: MediaRenameTarget;
      if (request.kind === "field") {
        target = {
          kind: "field",
          moduleFilePath,
          patchPath,
          path: request.path,
        };
      } else {
        const loaded = await loadForReferenceScan(
          sourceStore,
          jsonValuesLoadRequirements(schemas.data, {
            kind: "file",
            module: moduleFilePath,
          }),
          "use this file",
        );
        if (loaded.status === "error") {
          return { status: "error", message: loaded.message };
        }
        const referrers: MediaReferrer[] = [];
        for (const referrer of getFileReferrers(
          schemas.data,
          sourceStore.allSources(),
          moduleFilePath,
          request.key,
        )) {
          if (referrer.path !== null) {
            referrers.push({
              sourcePath: referrer.sourcePath,
              path: referrer.path,
              hasPatchId: referrer.hasPatchId,
            });
          }
        }
        target = {
          kind: "gallery-entry",
          moduleFilePath,
          patchPath,
          key: request.key,
          existingKeys: Object.keys(
            objectAt(sourceStore.moduleSource(moduleFilePath), patchPath),
          ),
          referrers,
        };
      }

      const plan = planMediaRename(target, patchStore.filePatchIds());
      if (plan.status === "error") {
        return plan;
      }
      let bytes: MediaBytes | null = null;
      if (plan.fetchUrl !== null) {
        const fetched = await fetchMediaBytes(
          plan.fetchUrl,
          plan.bytesParts.filename,
          request.metadata?.mimeType,
        );
        if (fetched.status === "error") {
          return fetched;
        }
        bytes = fetched.bytes;
      }
      const built = buildMediaRenamePatches({
        target,
        plan,
        newBase: request.newBase,
        bytes,
        metadata: request.metadata,
      });
      if (built.status !== "ok") {
        return built;
      }
      const { primary, referrers, newPath } = built.patches;
      const written = await writeModulePatch(
        primary.moduleFilePath,
        primary.patch,
        { fileType: request.fileType },
      );
      if (written.status === "error") {
        return written;
      }
      const failed: string[] = [];
      for (const referrer of referrers) {
        const res = await writeModulePatch(
          referrer.moduleFilePath,
          referrer.patch,
          { fileType: request.fileType },
        );
        if (res.status === "error") {
          failed.push(`${referrer.moduleFilePath}: ${res.message}`);
        }
      }
      if (failed.length > 0) {
        // The file IS renamed at this point, so this is not a refusal: it is
        // the list of fields still naming the old file, for someone to fix.
        return {
          status: "error",
          message: `Renamed, but these could not be updated to the new name: ${failed.join("; ")}`,
        };
      }
      return { status: "ok", newPath };
    },
    [val, schemas, path, patchPath, writeModulePatch],
  );
}

/** The object at `patchPath` inside `source`, or `{}` when there is none. */
function objectAt(
  source: Json | undefined,
  patchPath: readonly string[],
): JsonObject {
  let current: Json | undefined = source;
  for (const segment of patchPath) {
    if (!isJsonObject(current)) {
      return {};
    }
    current = current[segment];
  }
  return isJsonObject(current) ? current : {};
}

function isJsonObject(value: Json | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
