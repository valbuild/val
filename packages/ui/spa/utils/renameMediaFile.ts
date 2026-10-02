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
import { galleryKeyOf } from "./galleryKey";

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
      /** Where the extension (and, for remote, the hash) of the name come from. */
      nameParts: MediaPathParts;
      /**
       * The bytes to read before building, each keyed by the path they are
       * filed under NOW. Empty when nothing has to move.
       *
       * A list, not one file: in the legacy shape below every draft referrer
       * holds its own ref, filed under its own patch, and each has to be moved
       * under its own new ref.
       */
      fetches: { path: string; url: string }[];
      /**
       * The SHA-256 prefix the new name is built with, when it is known without
       * the bytes (a remote ref carries it). `null` means "hash the bytes".
       */
      knownHashPrefix: string | null;
      /**
       * The bytes live behind the referrers' remote refs, not at the gallery
       * key — so the referrers carry the `file` ops and the gallery none.
       */
      bytesOnReferrers: boolean;
      /** The local file the rename deletes, or `null` when the bytes are remote. */
      deletePath: string | null;
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
  const draftFetch = (path: string) => {
    const url = mediaUrlOf(path, filePatchIds);
    return url === null ? [] : [{ path, url }];
  };
  if (target.kind === "gallery-entry" && ownParts.kind === "local") {
    /*
     * A local KEY can still describe remote bytes.
     *
     * Uploading through an `s.image(remoteGallery)` FIELD puts the remote ref in
     * the field and files the gallery entry under the local path inside it
     * (`useImageUpload`), where uploading in the gallery itself keys the entry by
     * the ref. Both shapes are in projects, and `fillFromGallery` reads both, so
     * a rename has to as well: the bytes are where the referrers' refs say.
     *
     * EVERY referrer's, not the first one's. One entry can be named by several
     * refs — the same file uploaded before and after the core version moved the
     * validation hash — and which of them is a draft is per ref. Taking the first
     * made draft handling depend on the order modules happen to be walked in.
     */
    const remoteRefs = new Map<
      string,
      Extract<MediaPathParts, { kind: "remote" }>
    >();
    for (const referrer of target.referrers) {
      const referrerParts = parseMediaPath(referrer.path);
      if (referrerParts?.kind === "remote") {
        remoteRefs.set(referrer.path, referrerParts);
      }
    }
    if (remoteRefs.size > 0) {
      const prefixes = new Set(
        Array.from(remoteRefs.values(), (parts) => parts.fileHash.slice(0, 5)),
      );
      if (prefixes.size > 1) {
        // One name has to fit all of them, and the hash suffix is part of it.
        return {
          status: "error",
          message:
            "Fields point at this gallery entry with different files, so Val cannot give it one name.",
        };
      }
      return {
        status: "ok",
        nameParts: ownParts,
        fetches: Array.from(remoteRefs.keys())
          .filter((path) => filePatchIds.has(path))
          .flatMap(draftFetch),
        knownHashPrefix: Array.from(prefixes)[0],
        bytesOnReferrers: true,
        deletePath: null,
      };
    }
  }
  if (ownParts.kind === "remote") {
    return {
      status: "ok",
      nameParts: ownParts,
      fetches: filePatchIds.has(ownPath) ? draftFetch(ownPath) : [],
      // The remote file hash IS the first 12 hex of the SHA-256, so its first
      // five are the suffix the name was given at upload.
      knownHashPrefix: ownParts.fileHash.slice(0, 5),
      bytesOnReferrers: false,
      deletePath: null,
    };
  }
  return {
    status: "ok",
    nameParts: ownParts,
    fetches: draftFetch(ownPath),
    knownHashPrefix: null,
    bytesOnReferrers: false,
    deletePath: ownPath,
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
  /** Every `plan.fetches` entry's bytes, by its `path`. */
  bytes: ReadonlyMap<string, MediaBytes>;
  metadata: ImageMetadata | FileMetadata | undefined;
}):
  | { status: "ok"; patches: MediaRenamePatches }
  | { status: "unchanged" }
  | { status: "error"; message: string } {
  const { target, plan, newBase, bytes, metadata } = args;
  if (plan.fetches.some((fetch) => !bytes.has(fetch.path))) {
    return {
      status: "error",
      message:
        "The file's contents are needed to rename it, and were not read.",
    };
  }
  const ownPath = target.kind === "field" ? target.path : target.key;
  const hashSource = plan.knownHashPrefix ?? bytes.get(ownPath)?.sha256;
  if (hashSource === undefined) {
    return {
      status: "error",
      message: "Could not tell which file this is to rename it.",
    };
  }
  const ext = extensionOf(plan.nameParts.filename);
  const newFilename = Internal.createRenamedFilename(newBase, hashSource, ext);
  if (newFilename === null) {
    return {
      status: "error",
      message:
        "That name has no letters or digits Val can use in a file name. Try plain letters, digits and dashes.",
    };
  }
  const ownParts = parseMediaPath(ownPath);
  if (ownParts === null) {
    // `planMediaRename` already refused this; checked again so the types follow.
    return { status: "error", message: `Val cannot rename '${ownPath}'.` };
  }
  if (ownParts.filename === newFilename) {
    return { status: "unchanged" };
  }
  const newPath = withFilename(ownParts, newFilename);

  /** The bytes filed under `oldPath`, re-filed under `newFilePath`, if read. */
  const fileOp = (
    oldPath: string,
    newFilePath: string,
    path: string[],
  ): Operation[] => {
    const read = bytes.get(oldPath);
    return read === undefined
      ? []
      : [
          {
            op: "file",
            path,
            filePath: newFilePath,
            value: read.dataUrl,
            remote: parseMediaPath(newFilePath)?.kind === "remote",
            ...(metadata ? { metadata } : {}),
          },
        ];
  };
  /*
   * The old file goes, always — a rename that left it would be a copy, and the
   * only way to clean up after one would be by hand.
   *
   * Only for LOCAL bytes. Remote bytes are stored by hash, so the "old" file is
   * the new one too; and a remote delete would be filed under a URL, which
   * `ValOpsFS` turns into a path in the working tree.
   */
  const deleteOp = (path: string[]): Operation[] =>
    plan.deletePath === null
      ? []
      : [
          {
            op: "file",
            path,
            filePath: plan.deletePath,
            value: null,
            remote: false,
          },
        ];

  if (target.kind === "field") {
    const patch: Patch = [
      { op: "replace", path: [...target.patchPath, "path"], value: newPath },
      ...fileOp(ownPath, newPath, target.patchPath),
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

  /*
   * The gallery as it will be, and every referrer checked against it.
   *
   * Not just "is the new key free". A field resolves its entry exact key first
   * and the local path inside its ref second (`galleryKeyOf`), so in the legacy
   * shape a rewritten ref that happens to BE an existing full-ref key would
   * resolve to that other entry — its metadata, its alt text — rather than to
   * the one that was moved. The invariant a rename has to keep is that every
   * field it rewrites still lands on the entry it renamed.
   */
  const keysAfter = new Set(target.existingKeys);
  keysAfter.delete(target.key);
  if (keysAfter.has(newPath)) {
    return {
      status: "error",
      message: `The gallery already has a file called ${newFilename}.`,
    };
  }
  keysAfter.add(newPath);
  const rewritten: { referrer: MediaReferrer; newRefPath: string }[] = [];
  for (const referrer of target.referrers) {
    const referrerParts = parseMediaPath(referrer.path);
    if (referrerParts === null) {
      continue;
    }
    const newRefPath = withFilename(referrerParts, newFilename);
    if (galleryKeyOf(newRefPath, keysAfter) !== newPath) {
      return {
        status: "error",
        message: `The gallery already has an entry for ${newFilename} under another address, and the fields using this file would point at it instead.`,
      };
    }
    rewritten.push({ referrer, newRefPath });
  }

  const fromPath = [...target.patchPath, target.key];
  const toPath = [...target.patchPath, newPath];
  if (!array.isNonEmpty(fromPath) || !array.isNonEmpty(toPath)) {
    return { status: "error", message: "Not a gallery entry." };
  }
  const primary: Patch = [
    { op: "move", from: fromPath, path: toPath },
    // The bytes are filed at the MOVED entry, which is where the server stamps
    // the new patch id — unless they live behind the referrers' refs.
    ...(plan.bytesOnReferrers ? [] : fileOp(target.key, newPath, toPath)),
    ...deleteOp(fromPath),
  ];

  const byModule = new Map<ModuleFilePath, Operation[]>();
  for (const { referrer, newRefPath } of rewritten) {
    const [moduleFilePath, modulePath] =
      Internal.splitModuleFilePathAndModulePath(referrer.sourcePath);
    const referrerPatchPath = Internal.createPatchPath(modulePath);
    const ops = byModule.get(moduleFilePath) ?? [];
    ops.push({
      op: "replace",
      path: [...referrerPatchPath, "path"],
      value: newRefPath,
    });
    if (referrer.path !== target.key) {
      // Its own ref, so its own bytes: read for it if it is a draft.
      ops.push(...fileOp(referrer.path, newRefPath, referrerPatchPath));
    } else if (referrer.hasPatchId) {
      ops.push(...fileOp(target.key, newRefPath, referrerPatchPath));
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
