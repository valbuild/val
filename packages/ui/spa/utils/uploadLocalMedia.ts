import {
  FileMetadata,
  ImageMetadata,
  Internal,
  Json,
  ModuleFilePath,
  SerializedFileSchema,
  SerializedImageSchema,
  SerializedRecordSchema,
  ValidationFix,
} from "@valbuild/core";
import { array } from "@valbuild/core/fp";
import { Operation, Patch } from "@valbuild/core/patch";
import {
  extensionOf,
  type MediaBytes,
  type MediaReferrer,
} from "./renameMediaFile";

/**
 * Uploading a local file of a project with remote files: what
 * `val validate --fix` does for `*:upload-remote`, made by the Studio.
 *
 * A hosted project has no repository and no CLI, so the Validate page is the
 * only place its template's local images can be moved to remote storage. The
 * patches are the CLI's (`createFixPatch`), built here in the browser so the
 * bytes go up the way every other Studio upload does: a `file` op with
 * `remote: true`, stored with the patch and uploaded at publish.
 *
 * - **A gallery entry** is renamed from its local path to the ref, and every
 *   field that picked it -- rich text images included -- is pointed at the
 *   ref, as `collectionReferencePatches` does for the CLI.
 * - **A field** of its own (`s.image()` / `s.file()`) gets the ref as its
 *   `path`.
 *
 * The local file stays where it is, as it does after `--fix`.
 *
 * A video names several files and a stream is rewritten as it goes up, so
 * its rules are their own: `video/uploadLocalVideo.ts`.
 */

/**
 * The fixes the Studio makes by uploading from the browser: every
 * `*:upload-remote` code, the same set `val validate` reports as warnings.
 */
export const STUDIO_UPLOAD_FIXES = [
  "image:upload-remote",
  "file:upload-remote",
  "images:upload-remote",
  "files:upload-remote",
  "video:upload-remote",
  "videos:upload-remote",
] as const satisfies readonly ValidationFix[];

export type StudioUploadFix = (typeof STUDIO_UPLOAD_FIXES)[number];

export function isStudioUploadFix(fix: ValidationFix): fix is StudioUploadFix {
  return STUDIO_UPLOAD_FIXES.some((uploadFix) => uploadFix === fix);
}

/** What `/remote/settings` said, and the bucket picked from it. */
export type RemoteUploadSettings = {
  publicProjectId: string;
  bucket: string;
  coreVersion: string;
  remoteHost: string;
};

export type LocalMediaUploadTarget =
  | {
      kind: "gallery-entry";
      /** The gallery module. */
      moduleFilePath: ModuleFilePath;
      /** Patch path of the gallery record itself (`[]` for a module root). */
      patchPath: string[];
      /** The entry's key: its local path. */
      key: string;
      /** The record holding the entry: its `accept` and `dir` are hashed. */
      record: SerializedRecordSchema;
      /** The entry as stored: width, height, mime type, alt. */
      entry: Record<string, Json>;
      /** Every key the gallery has now. */
      existingKeys: readonly string[];
      referrers: MediaReferrer[];
    }
  | {
      kind: "field";
      moduleFilePath: ModuleFilePath;
      /** Patch path of the `s.image()` / `s.file()` field. */
      patchPath: string[];
      schema: SerializedImageSchema | SerializedFileSchema;
      /** The field's value as it is now. */
      value: { path: string } & Record<string, Json>;
    };

export type LocalMediaUploadPatches = {
  /** The remote ref the file is uploaded under. */
  ref: string;
  /** The gallery's or the field's own patch: carries the bytes. Written FIRST. */
  primary: { moduleFilePath: ModuleFilePath; patch: Patch };
  /** One patch per module naming the entry, written after the primary. */
  referrers: { moduleFilePath: ModuleFilePath; patch: Patch }[];
};

export function buildLocalMediaUploadPatches(args: {
  target: LocalMediaUploadTarget;
  bytes: MediaBytes;
  remote: RemoteUploadSettings;
}):
  | { status: "ok"; patches: LocalMediaUploadPatches }
  | { status: "error"; message: string } {
  const { target, bytes, remote } = args;
  const localPath = target.kind === "field" ? target.value.path : target.key;
  const filePath = localPath.startsWith("/public/")
    ? (localPath.slice(1) as `public/${string}`)
    : null;
  if (filePath === null || Internal.isRemoteMediaPath(localPath)) {
    return {
      status: "error",
      message: `Val cannot upload '${localPath}': it is not a file under /public.`,
    };
  }
  const filename = localPath.slice(localPath.lastIndexOf("/") + 1);

  // The schema and metadata the ref's validation hash is computed over: the
  // CLI's (`handleRemoteFileUpload`, `handleRemoteGalleryFileUpload`), so a
  // file uploaded here and one uploaded by `--fix` get the same ref.
  const { schema, metadata } =
    target.kind === "field"
      ? { schema: target.schema, metadata: withoutPath(target.value) }
      : {
          schema: galleryEntrySchema(target.record),
          metadata: target.entry,
        };
  const fileMetadata = fileMetadataOf(schema.type, metadata);
  if (fileMetadata === null) {
    return {
      status: "error",
      message: `Val does not know the size and type of ${filename}, so it cannot upload it. Open it and save it again, then try again.`,
    };
  }
  const fileHash = Internal.remote.hashToRemoteFileHash(bytes.sha256);
  const validationHash = Internal.remote.getValidationHash(
    remote.coreVersion,
    schema,
    extensionOf(filename),
    metadata,
    fileHash,
    new TextEncoder(),
  );
  const ref = Internal.remote.createRemoteRef(remote.remoteHost, {
    publicProjectId: remote.publicProjectId,
    coreVersion: remote.coreVersion,
    bucket: remote.bucket,
    validationHash,
    fileHash,
    filePath,
  });
  const fileOp = (path: string[]): Operation => ({
    op: "file",
    path,
    filePath: ref,
    value: bytes.dataUrl,
    remote: true,
    metadata: fileMetadata,
  });

  if (target.kind === "field") {
    return {
      status: "ok",
      patches: {
        ref,
        primary: {
          moduleFilePath: target.moduleFilePath,
          patch: [
            { op: "replace", path: [...target.patchPath, "path"], value: ref },
            fileOp(target.patchPath),
          ],
        },
        referrers: [],
      },
    };
  }

  if (target.existingKeys.includes(ref)) {
    return {
      status: "error",
      message: `The gallery already has ${filename} uploaded. Remove one of the two entries, then try again.`,
    };
  }
  const fromPath = [...target.patchPath, target.key];
  const toPath = [...target.patchPath, ref];
  if (!array.isNonEmpty(fromPath) || !array.isNonEmpty(toPath)) {
    return { status: "error", message: "Not a gallery entry." };
  }
  const byModule = new Map<ModuleFilePath, Operation[]>();
  for (const referrer of target.referrers) {
    const [moduleFilePath, modulePath] =
      Internal.splitModuleFilePathAndModulePath(referrer.sourcePath);
    const referrerPatchPath = Internal.createPatchPath(modulePath);
    const ops = byModule.get(moduleFilePath) ?? [];
    ops.push({
      op: "replace",
      path: [...referrerPatchPath, "path"],
      value: ref,
    });
    // A draft reads its URL off its OWN `patch_id`, which the server stamps
    // where a `file` op is: see `MediaReferrer.hasPatchId`.
    if (referrer.hasPatchId) {
      ops.push(fileOp(referrerPatchPath));
    }
    byModule.set(moduleFilePath, ops);
  }
  return {
    status: "ok",
    patches: {
      ref,
      primary: {
        moduleFilePath: target.moduleFilePath,
        // The bytes are filed at the MOVED entry, where the server stamps the
        // patch id.
        patch: [{ op: "move", from: fromPath, path: toPath }, fileOp(toPath)],
      },
      referrers: Array.from(byModule.entries()).map(
        ([moduleFilePath, patch]) => ({ moduleFilePath, patch }),
      ),
    },
  };
}

/**
 * The image or file schema a gallery ENTRY's ref is hashed with: the record's
 * `accept`, and for images its `dir`. `handleRemoteGalleryFileUpload`'s
 * synthesis, which this has to stay identical to -- a different shape bakes a
 * hash the CLI and the check will never agree with.
 */
function galleryEntrySchema(
  record: SerializedRecordSchema,
): SerializedImageSchema | SerializedFileSchema {
  if (record.mediaType === "files") {
    return {
      type: "file",
      opt: false,
      options: { ...(record.accept ? { accept: record.accept } : {}) },
    };
  }
  return {
    type: "image",
    opt: false,
    options: {
      ...(record.accept ? { accept: record.accept } : {}),
      ...(record.dir ? { dir: record.dir } : {}),
    },
  };
}

function withoutPath(
  value: { path: string } & Record<string, Json>,
): Record<string, Json> {
  const { path: _path, ...rest } = value;
  return rest;
}

/** What the `file` op says about the bytes, or `null` when it is not known. */
function fileMetadataOf(
  type: "image" | "file",
  metadata: Record<string, Json>,
): ImageMetadata | FileMetadata | null {
  const { width, height, mimeType } = metadata;
  if (typeof mimeType !== "string") {
    return null;
  }
  if (type === "file") {
    return { mimeType };
  }
  if (typeof width !== "number" || typeof height !== "number") {
    return null;
  }
  return { width, height, mimeType };
}
