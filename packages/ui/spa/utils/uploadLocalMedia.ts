import {
  Internal,
  Json,
  ModuleFilePath,
  SerializedFileSchema,
  SerializedImageSchema,
  SerializedRecordSchema,
} from "@valbuild/core";
import { array } from "@valbuild/core/fp";
import { JSONValue, Operation, Patch } from "@valbuild/core/patch";
import {
  isWarningFix,
  WARNING_FIXES,
  type WarningFix,
} from "@valbuild/shared/internal";
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
 * The fixes the Studio makes by uploading from the browser: exactly the codes
 * `val validate` reports as warnings (`WARNING_FIXES`), which are all "a local
 * file still to upload". One list, so a new one cannot be a warning in the
 * CLI and have no Fix here.
 */
export const STUDIO_UPLOAD_FIXES = WARNING_FIXES;
export type StudioUploadFix = WarningFix;
export const isStudioUploadFix = isWarningFix;

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

  // The schema and metadata the ref's validation hash is computed over: the
  // CLI's (`handleRemoteFileUpload`, `handleRemoteGalleryFileUpload`), so a
  // file uploaded here and one uploaded by `--fix` get the same ref.
  const { schema, metadata } =
    target.kind === "field"
      ? { schema: target.schema, metadata: withoutPath(target.value) }
      : {
          schema: galleryEntrySchemaOf(target.record),
          metadata: target.entry,
        };
  const made = remoteRefOf({
    localPath,
    schema,
    metadata,
    sha256: bytes.sha256,
    remote,
  });
  if (made.status === "error") {
    return made;
  }
  const { ref } = made;
  const filename = localPath.slice(localPath.lastIndexOf("/") + 1);
  const fileMetadata = fileMetadataOf(schema.type, metadata, bytes.dataUrl);
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

/** The schema a gallery's entry is validated (and its ref hashed) against. */
export function galleryEntrySchemaOf(
  record: SerializedRecordSchema,
): SerializedImageSchema | SerializedFileSchema {
  return Internal.galleryEntryMediaSchema(
    record.mediaType === "files" ? "file" : "image",
    record,
  );
}

/**
 * The remote ref a file at `localPath` is uploaded under: the one rule, for
 * every way a file gets into remote storage from the Studio -- a local file
 * moved there by Fix, and an image the assistant was given.
 */
export function remoteRefOf(args: {
  /** Where the file would be under `/public`: `/public/val/a.png`. */
  localPath: string;
  schema: SerializedImageSchema | SerializedFileSchema;
  /**
   * The value or gallery entry, as it will be stored. Its width, height and
   * mime type are hashed with the bytes.
   */
  metadata: Record<string, unknown>;
  /** SHA-256 of the bytes, hex. */
  sha256: string;
  remote: RemoteUploadSettings;
}): { status: "ok"; ref: string } | { status: "error"; message: string } {
  const { localPath, schema, metadata, sha256, remote } = args;
  const filePath = publicFilePathOf(localPath);
  if (filePath === null || Internal.isRemoteMediaPath(localPath)) {
    return {
      status: "error",
      message: `Val cannot upload '${localPath}': it is not a file under /public.`,
    };
  }
  const filename = localPath.slice(localPath.lastIndexOf("/") + 1);
  const fileHash = Internal.remote.hashToRemoteFileHash(sha256);
  const validationHash = Internal.remote.getValidationHash(
    remote.coreVersion,
    schema,
    extensionOf(filename),
    metadata,
    fileHash,
    new TextEncoder(),
  );
  return {
    status: "ok",
    ref: Internal.remote.createRemoteRef(remote.remoteHost, {
      publicProjectId: remote.publicProjectId,
      coreVersion: remote.coreVersion,
      bucket: remote.bucket,
      validationHash,
      fileHash,
      filePath,
    }),
  };
}

function withoutPath(
  value: { path: string } & Record<string, Json>,
): Record<string, Json> {
  const { path: _path, ...rest } = value;
  return rest;
}

/**
 * What the `file` op says about the bytes: what is recorded, and the data
 * URL's type when nothing is. A size that was never recorded is not made up
 * here -- the CLI uploads without one too, and the value is left with the
 * `image:add-metadata` row it already had, which the Studio fixes.
 */
function fileMetadataOf(
  type: "image" | "file",
  metadata: Record<string, Json>,
  dataUrl: string,
): JSONValue {
  const { width, height, mimeType } = metadata;
  const knownMimeType =
    typeof mimeType === "string" ? mimeType : Internal.getMimeType(dataUrl);
  return {
    ...(knownMimeType !== undefined ? { mimeType: knownMimeType } : {}),
    ...(type === "image" && typeof width === "number" ? { width } : {}),
    ...(type === "image" && typeof height === "number" ? { height } : {}),
  };
}

/** `public/val/a.png` for `/public/val/a.png`: the path a remote ref names. */
export function publicFilePathOf(localPath: string): `public/${string}` | null {
  const prefix = "/public/";
  return localPath.startsWith(prefix)
    ? `public/${localPath.slice(prefix.length)}`
    : null;
}
