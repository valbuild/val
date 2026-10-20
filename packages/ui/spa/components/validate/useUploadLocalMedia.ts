import { useCallback } from "react";
import {
  Internal,
  Json,
  ModuleFilePath,
  ModulePath,
  PatchId,
  SerializedFileSchema,
  SerializedImageSchema,
  SerializedRecordSchema,
  SerializedSchema,
  SerializedVideoSchema,
  SourcePath,
} from "@valbuild/core";
import type { Patch } from "@valbuild/core/patch";
import { useSchemas } from "../ValFieldProvider";
import {
  useCurrentRemoteFileBucket,
  useRemoteFiles,
  useRemoteHost,
} from "../ValRemoteProvider";
import { useValSystem } from "../../stores/react/SystemContext";
import type { SourceStore } from "../../stores/SourceStore";
import type { PatchStore } from "../../stores/PatchStore";
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
import {
  placeLocalVideoFiles,
  videoFieldUploadPatch,
  videoPathsOf,
  videosetEntrySchema,
  videosetEntryUploadPatches,
  type ReadLocalFile,
} from "../../utils/video/uploadLocalVideo";
import { sha256Hex } from "../../utils/video/sha256";

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

type Failure = Extract<UploadLocalMediaResult, { status: "error" }>;

/** The patches a fix writes: the primary carries the bytes and goes first. */
type UploadPatches = {
  primary: { moduleFilePath: ModuleFilePath; patch: Patch };
  referrers: { moduleFilePath: ModuleFilePath; patch: Patch }[];
  /** What went up, for the row: `dusk.mp4 and 1 more file`. */
  what: string;
};

/**
 * The Validate page's **Fix** for a local file in a project with remote files
 * (`*:upload-remote`): the files go up the way any Studio upload does. The
 * rules are in `uploadLocalMedia.ts` and `video/uploadLocalVideo.ts`; this is
 * the part that talks to the stores, in the order `useRenameMediaFile` does
 * it:
 *
 * 1. **Load what the reference scan needs** (a gallery or video set entry
 *    only), and refuse if it cannot be complete: a rename on a partial scan
 *    leaves fields naming an entry that no longer exists.
 * 2. **Read the bytes** back from where the Studio shows them.
 * 3. **Write the entry's or the field's own patch, and wait for it.** It
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
      let located: Located | Failure;
      try {
        located = await locate(
          sourcePath,
          fix,
          schemas.data,
          sourceStore,
          filePatchIds,
        );
      } catch {
        // `resolvePath` throws for a path the content no longer has.
        located = {
          status: "error",
          message: "This file is no longer there. Check the module again.",
          retry: false,
        };
      }
      if ("status" in located) {
        return located;
      }
      const built =
        located.mediaType === "video"
          ? await videoPatches(located, remote, filePatchIds)
          : await imageOrFilePatches(located, remote, filePatchIds);
      if ("status" in built) {
        return built;
      }
      return writeAll(
        patchStore,
        built,
        located.mediaType === "image" ? "image" : "file",
      );
    },
    [val, schemas, remoteFiles, bucket, remoteHost],
  );
}

/** Where the fix is: a field of its own, or an entry of a collection. */
type Located = { mediaType: "image" | "file" | "video" } & (
  | {
      kind: "field";
      moduleFilePath: ModuleFilePath;
      patchPath: string[];
      schema:
        | SerializedImageSchema
        | SerializedFileSchema
        | SerializedVideoSchema;
      value: { path: string } & Record<string, Json>;
    }
  | {
      kind: "entry";
      moduleFilePath: ModuleFilePath;
      /** Patch path of the collection record (`[]` for a module root). */
      patchPath: string[];
      record: SerializedRecordSchema;
      key: string;
      entry: Record<string, Json>;
      existingKeys: readonly string[];
      referrers: MediaReferrer[];
    }
);

async function imageOrFilePatches(
  located: Located,
  remote: RemoteUploadSettings,
  filePatchIds: ReadonlyMap<string, string>,
): Promise<UploadPatches | Failure> {
  const localPath = located.kind === "field" ? located.value.path : located.key;
  const filename = filenameOf(localPath);
  const url = mediaUrlOf(localPath, filePatchIds);
  if (url === null) {
    return {
      status: "error",
      message: `Val does not know where ${filename} is served from, so nothing was uploaded.`,
      retry: false,
    };
  }
  const mimeType =
    located.kind === "field" ? located.value.mimeType : located.entry.mimeType;
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
  let target: LocalMediaUploadTarget;
  if (located.kind === "entry") {
    target = {
      kind: "gallery-entry",
      moduleFilePath: located.moduleFilePath,
      patchPath: located.patchPath,
      key: located.key,
      record: located.record,
      entry: located.entry,
      existingKeys: located.existingKeys,
      referrers: located.referrers,
    };
  } else if (located.schema.type !== "video") {
    target = {
      kind: "field",
      moduleFilePath: located.moduleFilePath,
      patchPath: located.patchPath,
      schema: located.schema,
      value: located.value,
    };
  } else {
    return {
      status: "error",
      message: "Not an image or a file.",
      retry: false,
    };
  }
  const built = buildLocalMediaUploadPatches({
    target,
    bytes: fetched.bytes,
    remote,
  });
  if (built.status === "error") {
    return { ...built, retry: false };
  }
  return { ...built.patches, what: filename };
}

async function videoPatches(
  located: Located,
  remote: RemoteUploadSettings,
  filePatchIds: ReadonlyMap<string, string>,
): Promise<UploadPatches | Failure> {
  const read: ReadLocalFile = async (localPath) => {
    const filename = filenameOf(localPath);
    const url = mediaUrlOf(localPath, filePatchIds);
    if (url === null) {
      throw new Error(`Val does not know where ${filename} is served from.`);
    }
    let res: Response;
    try {
      res = await fetch(url);
    } catch (err) {
      throw new Error(
        `Could not read ${filename}: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
    // A dev server answers a path it has no file for with the app's HTML and
    // a 200: see `fetchMediaBytes`.
    if (
      !res.ok ||
      (res.headers.get("content-type") ?? "").startsWith("text/html")
    ) {
      throw new Error(
        res.ok
          ? `Could not read ${filename}: the server answered with a web page instead of the file.`
          : `Could not read ${filename} (HTTP ${res.status}).`,
      );
    }
    return new Uint8Array(await res.arrayBuffer());
  };
  const video: Record<string, Json> =
    located.kind === "field"
      ? located.value
      : { ...located.entry, path: located.key };
  const schema =
    located.kind === "entry"
      ? videosetEntrySchema(located.record)
      : located.schema.type === "video"
        ? located.schema
        : null;
  if (schema === null) {
    return { status: "error", message: "Not a video.", retry: false };
  }
  // A field picked from a set names the SET's video: only its own poster and
  // captions are its to move. The set's entry moves the video, and the fields
  // that name it with it.
  const paths = videoPathsOf(video).filter(
    ({ at }) =>
      !(
        located.kind === "field" &&
        schema.referencedModule &&
        at[0] === "path"
      ),
  );
  let files;
  try {
    files = await placeLocalVideoFiles({
      paths,
      video,
      schema,
      remote,
      read,
      sha256: sha256Hex,
    });
  } catch (err) {
    return {
      status: "error",
      message: `${err instanceof Error ? err.message : String(err)} Nothing was uploaded.`,
      retry: true,
    };
  }
  if (files.length === 0) {
    return {
      status: "error",
      message: "This video has no local files left. Check the module again.",
      retry: false,
    };
  }
  const named = paths
    .map(({ path }) => files.find((file) => file.localPath === path))
    .filter((file) => file !== undefined);
  const first = named[0] ?? files[0];
  const others = named.length - 1;
  const what = `${filenameOf(first.localPath)}${
    others > 0 ? ` and ${others} more ${others === 1 ? "file" : "files"}` : ""
  }`;
  if (located.kind === "field") {
    return {
      primary: {
        moduleFilePath: located.moduleFilePath,
        patch: videoFieldUploadPatch(located.patchPath, located.value, files),
      },
      referrers: [],
      what,
    };
  }
  const built = videosetEntryUploadPatches({
    moduleFilePath: located.moduleFilePath,
    patchPath: located.patchPath,
    key: located.key,
    entry: located.entry,
    existingKeys: located.existingKeys,
    referrers: located.referrers,
    files,
  });
  if (built.status === "error") {
    return { ...built, retry: false };
  }
  return { primary: built.primary, referrers: built.referrers, what };
}

async function writeAll(
  patchStore: PatchStore,
  { primary, referrers, what }: UploadPatches,
  fileType: "image" | "file",
): Promise<UploadLocalMediaResult> {
  const write = (moduleFilePath: ModuleFilePath, patch: Patch) =>
    patchStore.createPatch(
      moduleFilePath,
      patch,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      fileType,
    );
  const written = await write(primary.moduleFilePath, primary.patch);
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
    const res = await write(referrer.moduleFilePath, referrer.patch);
    if (res.status === "created") {
      patchIds.push(res.record.patchId);
    } else {
      failed.push(`${referrer.moduleFilePath}: ${res.message}`);
    }
  }
  if (failed.length > 0) {
    // The file IS uploaded at this point, so this is not a refusal: it is the
    // list of fields still naming the local file, for someone to fix.
    return {
      status: "ok",
      patchIds,
      summary: `Uploaded ${what}, but these still name the local file: ${failed.join("; ")}`,
    };
  }
  const using =
    referrers.length > 0
      ? `, and pointed ${referrers.length} ${referrers.length === 1 ? "module" : "modules"} using it at the upload`
      : "";
  return {
    status: "ok",
    patchIds,
    summary: `Uploads ${what} when published${using}.`,
  };
}

async function locate(
  sourcePath: SourcePath,
  fix: StudioUploadFix,
  schemas: Record<ModuleFilePath, SerializedSchema>,
  sourceStore: SourceStore,
  filePatchIds: ReadonlyMap<string, string>,
): Promise<Located | Failure> {
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(sourcePath);
  const moduleSchema = schemas[moduleFilePath];
  const moduleSource = sourceStore.moduleSource(moduleFilePath);
  if (moduleSchema === undefined || moduleSource === undefined) {
    return {
      status: "error",
      message: `${moduleFilePath} is not loaded, so nothing was uploaded.`,
      retry: true,
    };
  }
  if (
    fix === "image:upload-remote" ||
    fix === "file:upload-remote" ||
    fix === "video:upload-remote"
  ) {
    const resolved = Internal.resolvePath(
      modulePath,
      moduleSource,
      moduleSchema,
    );
    const value = resolved.source;
    if (
      (resolved.schema.type !== "image" &&
        resolved.schema.type !== "file" &&
        resolved.schema.type !== "video") ||
      !isJsonObject(value) ||
      typeof value.path !== "string"
    ) {
      return {
        status: "error",
        message: "This is no longer a local file. Check the module again.",
        retry: false,
      };
    }
    return {
      kind: "field",
      mediaType: resolved.schema.type,
      moduleFilePath,
      patchPath: Internal.createPatchPath(modulePath),
      schema: resolved.schema,
      value: { ...value, path: value.path },
    };
  }

  // An entry of a collection: its key is the last segment of its path.
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
      message: "This entry is no longer there. Check the module again.",
      retry: false,
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
    return { status: "error", message: loaded.message, retry: true };
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
    kind: "entry",
    moduleFilePath,
    patchPath: recordModulePath
      ? Internal.createPatchPath(recordModulePath as ModulePath)
      : [],
    mediaType:
      fix === "videos:upload-remote"
        ? "video"
        : fix === "files:upload-remote"
          ? "file"
          : "image",
    record: record.schema,
    key,
    entry,
    existingKeys: Object.keys(entries),
    referrers,
  };
}

function filenameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function isJsonObject(value: unknown): value is { [key: string]: Json } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
