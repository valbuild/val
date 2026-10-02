import {
  FileMetadata,
  ImageMetadata,
  Internal,
  ModuleFilePath,
  SourcePath,
} from "@valbuild/core";
import { array } from "@valbuild/core/fp";
import { Operation, Patch } from "@valbuild/core/patch";
import { mediaUrlOf } from "./mediaUrl";

/**
 * Renaming a media file.
 *
 * A file has a NAME in three places and BYTES in one, and a rename has to move
 * the name everywhere while moving the bytes only where they actually are:
 *
 * - **Local** (`/public/val/hero_a1b2c.png`): the bytes are at the path, so a
 *   rename is a copy to the new path and a delete of the old one. The copy is a
 *   re-upload of bytes fetched back from where the Studio already shows them,
 *   which works the same in `fs` and `http` mode, published or draft.
 * - **Remote, published**: the content host stores bytes by HASH
 *   (`b/{bucket}/f/{hash}.{ext}`) and serves `…/f/{hash}/p/{path}` by hash and
 *   extension alone, so the path inside a remote ref is a label. A rename is a
 *   new ref string and nothing is uploaded or deleted.
 * - **Remote, draft**: the bytes are in the patch store, filed under the ref
 *   they were uploaded with, and the Studio finds them by that ref
 *   (`filePatchIds`). A new ref would find nothing, so the bytes are uploaded
 *   again under it. Publishing then PUTs the same hash twice; the content host
 *   answers the second with 409, which counts as success.
 *
 * The hash suffix and the extension never change — see
 * `Internal.createRenamedFilename` for why.
 */

/** Where a media path points, read apart. */
export type MediaPathParts =
  | {
      kind: "local";
      /** `/public/val` — no trailing slash. */
      dir: string;
      filename: string;
    }
  | {
      kind: "remote";
      dir: string;
      filename: string;
      remoteHost: string;
      projectId: string;
      bucket: string;
      version: string;
      validationHash: string;
      /** The first 12 hex of the bytes' SHA-256. */
      fileHash: string;
    };

/**
 * `null` for anything a rename cannot handle: an absolute path outside
 * `/public`, an `.external()` record's ref, a URL this version cannot parse.
 * Those are refused rather than guessed at — renaming a path we cannot read
 * back is how a file ends up pointing nowhere.
 */
export function parseMediaPath(path: string): MediaPathParts | null {
  const remote = Internal.remote.splitRemoteRef(path);
  if (remote.status === "success") {
    const filePath = `/${remote.filePath}`;
    const slash = filePath.lastIndexOf("/");
    return {
      kind: "remote",
      dir: filePath.slice(0, slash),
      filename: filePath.slice(slash + 1),
      remoteHost: remote.remoteHost,
      projectId: remote.projectId,
      bucket: remote.bucket,
      version: remote.version,
      validationHash: remote.validationHash,
      fileHash: remote.fileHash,
    };
  }
  if (!path.startsWith("/public/")) {
    return null;
  }
  const slash = path.lastIndexOf("/");
  const filename = path.slice(slash + 1);
  if (filename === "") {
    return null;
  }
  return { kind: "local", dir: path.slice(0, slash), filename };
}

/** `"png"` for `hero_a1b2c.png`, `""` for a file with no extension. */
export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot <= 0 ? "" : filename.slice(dot + 1);
}

/**
 * The same file under `newFilename`, in the same directory and — for a remote
 * ref — the same project, bucket, hash and validation hash. Only the label
 * moves, which is exactly what makes a published remote rename free.
 */
export function withFilename(parts: MediaPathParts, newFilename: string) {
  if (parts.kind === "local") {
    return `${parts.dir}/${newFilename}`;
  }
  return Internal.remote.createRemoteRef(parts.remoteHost, {
    publicProjectId: parts.projectId,
    coreVersion: parts.version,
    bucket: parts.bucket,
    validationHash: parts.validationHash,
    fileHash: parts.fileHash,
    // `dir` keeps its leading slash; the ref's path does not have one.
    filePath: `${parts.dir.slice(1)}/${newFilename}` as `public/${string}`,
  });
}

/** One field pointing at the file being renamed, and the path it holds. */
export type MediaReferrer = {
  sourcePath: SourcePath;
  /** The referrer's `path` as it is now. */
  path: string;
  /**
   * Whether the referrer's value carries a `patch_id` — i.e. it uploaded these
   * bytes itself and that upload is still a draft.
   *
   * The app reads a draft image's URL off the FIELD's own `patch_id`
   * (`stegaEncode` → `Internal.mediaUrl`), never off the gallery's, so such a
   * referrer needs a `file` op of its own for the server to stamp the new id
   * onto it. Without one it keeps pointing at the old patch, which has no file
   * at the new path.
   */
  hasPatchId: boolean;
};

/** What is being renamed. */
export type MediaRenameTarget =
  | {
      kind: "gallery-entry";
      /** The gallery module. */
      moduleFilePath: ModuleFilePath;
      /** Patch path of the gallery record itself (`[]` for a module root). */
      patchPath: string[];
      /** The entry's key, which is the file's path. */
      key: string;
      /**
       * Every key the gallery has now. A `move` onto a key that exists
       * REPLACES that entry, so a rename onto one is refused rather than
       * silently losing an image.
       */
      existingKeys: readonly string[];
      referrers: MediaReferrer[];
    }
  | {
      kind: "field";
      moduleFilePath: ModuleFilePath;
      /** Patch path of the `s.image()` / `s.file()` field. */
      patchPath: string[];
      /** The field's `path` as it is now. */
      path: string;
    };

/**
 * What a rename has to do before it can build its patches.
 *
 * Two steps because the name depends on the bytes: a local file's hash suffix
 * comes from its SHA-256, and the only way to know that for certain is to read
 * the bytes — which a local rename has to do anyway, to copy them.
 */
export type MediaRenamePlan =
  | { status: "error"; message: string }
  | {
      status: "ok";
      /** The path that holds the bytes (a gallery key, a field, or a referrer). */
      bytesPath: string;
      bytesParts: MediaPathParts;
      /** Where to fetch the bytes from, or `null` when none need moving. */
      fetchUrl: string | null;
      /**
       * The SHA-256 prefix the new name is built with, when it is known without
       * the bytes (a remote ref carries it). `null` means "hash the bytes".
       */
      knownHashPrefix: string | null;
    };

export function planMediaRename(
  target: MediaRenameTarget,
  filePatchIds: ReadonlyMap<string, string>,
): MediaRenamePlan {
  const ownPath = target.kind === "field" ? target.path : target.key;
  const ownParts = parseMediaPath(ownPath);
  if (ownParts === null) {
    return {
      status: "error",
      message: `Val cannot rename '${ownPath}': it is neither a file under /public nor a remote file.`,
    };
  }
  let bytesPath = ownPath;
  let bytesParts: MediaPathParts = ownParts;
  if (target.kind === "gallery-entry" && ownParts.kind === "local") {
    /*
     * A local KEY can still describe remote bytes.
     *
     * Uploading through an `s.image(remoteGallery)` FIELD puts the remote ref in
     * the field and files the gallery entry under the local path inside it
     * (`useImageUpload`), where uploading in the gallery itself keys the entry by
     * the ref. Both shapes are in projects, and `fillFromGallery` reads both, so
     * a rename has to as well: the bytes are where the referrer's ref says.
     */
    for (const referrer of target.referrers) {
      const referrerParts = parseMediaPath(referrer.path);
      if (referrerParts?.kind === "remote") {
        bytesPath = referrer.path;
        bytesParts = referrerParts;
        break;
      }
    }
  }
  if (bytesParts.kind === "remote") {
    const isDraft = filePatchIds.has(bytesPath);
    return {
      status: "ok",
      bytesPath,
      bytesParts,
      fetchUrl: isDraft ? mediaUrlOf(bytesPath, filePatchIds) : null,
      // The remote file hash IS the first 12 hex of the SHA-256, so its first
      // five are the suffix the name was given at upload.
      knownHashPrefix: bytesParts.fileHash.slice(0, 5),
    };
  }
  return {
    status: "ok",
    bytesPath,
    bytesParts,
    fetchUrl: mediaUrlOf(bytesPath, filePatchIds),
    knownHashPrefix: null,
  };
}

/** The bytes of the file, read back from where they are served. */
export type MediaBytes = {
  /** A base64 data URL — what every `file` op carries. */
  dataUrl: string;
  /** SHA-256 of the decoded bytes, hex. */
  sha256: string;
};

export type MediaRenamePatches = {
  /** The new name, e.g. `team-photo_a1b2c.png`. */
  newFilename: string;
  /** The renamed gallery key, or the field's new `path`. */
  newPath: string;
  /** The gallery's or the field's own patch. Written FIRST. */
  primary: { moduleFilePath: ModuleFilePath; patch: Patch };
  /**
   * One patch per module that refers to the file, written only after the
   * primary one has landed: a referrer must never get ahead of the gallery
   * entry it names.
   */
  referrers: { moduleFilePath: ModuleFilePath; patch: Patch }[];
};

export function buildMediaRenamePatches(args: {
  target: MediaRenameTarget;
  plan: Extract<MediaRenamePlan, { status: "ok" }>;
  /** What the person typed, without the hash suffix or extension. */
  newBase: string;
  /** Required when `plan.fetchUrl` is set. */
  bytes: MediaBytes | null;
  metadata: ImageMetadata | FileMetadata | undefined;
}):
  | { status: "ok"; patches: MediaRenamePatches }
  | { status: "unchanged" }
  | { status: "error"; message: string } {
  const { target, plan, newBase, bytes, metadata } = args;
  if (plan.fetchUrl !== null && bytes === null) {
    return {
      status: "error",
      message:
        "The file's contents are needed to rename it, and were not read.",
    };
  }
  const hashSource = plan.knownHashPrefix ?? bytes?.sha256;
  if (hashSource === undefined) {
    return {
      status: "error",
      message: "Could not tell which file this is to rename it.",
    };
  }
  const ext = extensionOf(plan.bytesParts.filename);
  const newFilename = Internal.createRenamedFilename(newBase, hashSource, ext);
  if (newFilename === null) {
    return {
      status: "error",
      message:
        "That name has no letters or digits Val can use in a file name. Try plain letters, digits and dashes.",
    };
  }
  const ownPath = target.kind === "field" ? target.path : target.key;
  const ownParts = parseMediaPath(ownPath);
  if (ownParts === null) {
    // `planMediaRename` already refused this; checked again so the types follow.
    return { status: "error", message: `Val cannot rename '${ownPath}'.` };
  }
  if (ownParts.filename === newFilename) {
    return { status: "unchanged" };
  }
  const newPath = withFilename(ownParts, newFilename);
  const newBytesPath = withFilename(plan.bytesParts, newFilename);
  const remote = plan.bytesParts.kind === "remote";

  const fileOp = (path: string[]): Operation[] =>
    bytes === null
      ? []
      : [
          {
            op: "file",
            path,
            filePath: newBytesPath,
            value: bytes.dataUrl,
            remote,
            ...(metadata ? { metadata } : {}),
          },
        ];
  /*
   * The old file goes, always — a rename that left it would be a copy, and the
   * only way to clean up after one would be by hand.
   *
   * Only for LOCAL bytes. Remote bytes are stored by hash, so the "old" file is
   * the new one too; and a remote delete would be filed under a URL, which
   * `ValOpsFS` turns into a path in the working tree.
   */
  const deleteOp = (path: string[]): Operation[] =>
    remote
      ? []
      : [
          {
            op: "file",
            path,
            filePath: plan.bytesPath,
            value: null,
            remote: false,
          },
        ];

  if (target.kind === "field") {
    const patch: Patch = [
      { op: "replace", path: [...target.patchPath, "path"], value: newPath },
      ...fileOp(target.patchPath),
      ...deleteOp(target.patchPath),
    ];
    return {
      status: "ok",
      patches: {
        newFilename,
        newPath,
        primary: { moduleFilePath: target.moduleFilePath, patch },
        referrers: [],
      },
    };
  }

  if (target.existingKeys.includes(newPath)) {
    return {
      status: "error",
      message: `The gallery already has a file called ${newFilename}.`,
    };
  }
  const fromPath = [...target.patchPath, target.key];
  const toPath = [...target.patchPath, newPath];
  if (!array.isNonEmpty(fromPath) || !array.isNonEmpty(toPath)) {
    return { status: "error", message: "Not a gallery entry." };
  }
  const primary: Patch = [
    { op: "move", from: fromPath, path: toPath },
    // The bytes are filed at the MOVED entry, which is where the server stamps
    // the new patch id.
    ...fileOp(toPath),
    ...deleteOp(fromPath),
  ];

  const byModule = new Map<ModuleFilePath, Operation[]>();
  for (const referrer of target.referrers) {
    const referrerParts = parseMediaPath(referrer.path);
    if (referrerParts === null) {
      continue;
    }
    const [moduleFilePath, modulePath] =
      Internal.splitModuleFilePathAndModulePath(referrer.sourcePath);
    const referrerPatchPath = Internal.createPatchPath(modulePath);
    const ops = byModule.get(moduleFilePath) ?? [];
    ops.push({
      op: "replace",
      path: [...referrerPatchPath, "path"],
      value: withFilename(referrerParts, newFilename),
    });
    if (referrer.hasPatchId) {
      ops.push(...fileOp(referrerPatchPath));
    }
    byModule.set(moduleFilePath, ops);
  }
  return {
    status: "ok",
    patches: {
      newFilename,
      newPath,
      primary: { moduleFilePath: target.moduleFilePath, patch: primary },
      referrers: Array.from(byModule.entries()).map(
        ([moduleFilePath, patch]) => ({ moduleFilePath, patch }),
      ),
    },
  };
}

/**
 * A filename read apart into what an editor may change and what they may not.
 *
 * `photo_a1b2c.png` → `{ base: "photo", locked: "_a1b2c.png" }`. A name without
 * Val's hash suffix (a file someone put in `/public` by hand) locks only the
 * extension; a rename then gives it a suffix, the way an upload would have.
 */
export function splitEditableFilename(filename: string): {
  base: string;
  locked: string;
} {
  const ext = extensionOf(filename);
  const stem = ext === "" ? filename : filename.slice(0, -(ext.length + 1));
  const extPart = ext === "" ? "" : `.${ext}`;
  const match = stem.match(/^(.+)(_[0-9a-f]{5})$/);
  if (match) {
    return { base: match[1], locked: `${match[2]}${extPart}` };
  }
  return { base: stem, locked: extPart };
}
