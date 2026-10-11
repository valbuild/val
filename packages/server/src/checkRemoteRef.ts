import path from "path";
import {
  FileMetadata,
  ImageMetadata,
  Internal,
  SerializedFileSchema,
  SerializedImageSchema,
} from "@valbuild/core";
import http from "http";
import https from "https";
import fs from "fs";
import { getFileExt } from "./getFileExt";
import { extractFileMetadata, extractImageMetadata } from "./extractMetadata";
import { fallbackRefOf } from "./remoteHostCheck";

const textEncoder = new TextEncoder();
export async function checkRemoteRef(
  /**
   * Unused: a re-derived ref keeps the host it already names (see below).
   * Kept so the exported signature does not change.
   */
  _remoteHost: string,
  ref: string,
  projectRoot: string,
  schema: SerializedImageSchema | SerializedFileSchema,
  metadata: Record<string, unknown> | undefined,
  /**
   * Where the bytes come from when the ref has to be re-derived. Defaults to
   * a download cached under `projectRoot`; the Studio passes one that keeps
   * nothing on disk (`FixFiles.readRemoteFile`).
   */
  readRemote: ReadRemoteFile = (ref, fileExt, fileHash) =>
    getFileBufferFromRemote(ref, fileExt, fileHash, projectRoot),
): Promise<
  | { status: "success" }
  | {
      status: "fix-required";
      metadata: ImageMetadata | FileMetadata;
      ref: string;
    }
  | {
      status: "error";
      error: string;
    }
> {
  const remoteRefDataRes = Internal.remote.splitRemoteRef(ref);
  if (remoteRefDataRes.status === "error") {
    return remoteRefDataRes;
  }
  const fileHash = remoteRefDataRes.fileHash;
  if (!fileHash) {
    return {
      status: "error",
      error: `File hash is missing in remote ref: ${ref}`,
    };
  }
  const relativeFilePath = remoteRefDataRes.filePath;
  if (!relativeFilePath) {
    return {
      status: "error",
      error: `File path is missing in remote ref: ${ref}`,
    };
  }
  if (!relativeFilePath.startsWith("public/")) {
    return {
      status: "error",
      error: `File path must be within the public/ directory (e.g. public/path/to/file.txt). Got: ${relativeFilePath}`,
    };
  }
  const coreVersion = Internal.VERSION.core || "unknown";
  const fileExt = getFileExt(relativeFilePath);
  const currentValidationHash = Internal.remote.getValidationHash(
    coreVersion,
    schema,
    fileExt,
    metadata as Record<string, unknown> | undefined, // TODO: validate
    fileHash,
    textEncoder,
  );

  const validationHashFromRemoteRefValues = Internal.remote.getValidationHash(
    remoteRefDataRes.version,
    schema,
    getFileExt(remoteRefDataRes.filePath),
    metadata as Record<string, unknown> | undefined, // TODO: validate
    fileHash,
    textEncoder,
  );

  if (
    // Current validation hash is the same as the remote validation hash
    // We assume the uploaded file exists and is correct
    currentValidationHash === remoteRefDataRes.validationHash &&
    // This can happen if the version or fileExt has been tampered with
    // (or if the way it is computed has changed)
    validationHashFromRemoteRefValues === remoteRefDataRes.validationHash
  ) {
    return {
      status: "success",
    };
  }
  // Validation hash does not match, so we need to re-validate the remote content
  const fileBufferRes = await readRemote(
    ref,
    fileExt,
    remoteRefDataRes.fileHash,
  );

  // We could not download the remote file for some reason (for example, the file hash is wrong)
  if (fileBufferRes.status === "error") {
    return fileBufferRes;
  }

  // At this point we have the file buffer and we know the correct file hash
  // We must create a new ref since something has changed

  let currentMetadata: ImageMetadata | FileMetadata;
  try {
    if (schema.type === "image") {
      currentMetadata = await extractImageMetadata(
        remoteRefDataRes.filePath,
        fileBufferRes.fileBuffer,
      );
    } else if (schema.type === "file") {
      currentMetadata = await extractFileMetadata(
        remoteRefDataRes.filePath,
        fileBufferRes.fileBuffer,
      );
    } else {
      const exhaustiveCheck: never = schema;
      return {
        status: "error",
        error: `Unknown schema type: ${JSON.stringify(exhaustiveCheck)}`,
      };
    }
  } catch (err) {
    return {
      status: "error",
      error: `Failed to extract metadata from remote file: ${err instanceof Error ? err.message : "Unknown error"}${fileBufferRes.cachedFilePath ? `. Cached file: ${fileBufferRes.cachedFilePath}` : ""}`,
    };
  }
  const updatedMetadata = {
    ...metadata,
    ...currentMetadata,
  };
  const nextValidationHash = Internal.remote.getValidationHash(
    coreVersion,
    schema,
    fileExt,
    updatedMetadata,
    fileBufferRes.fileHash,
    textEncoder,
  );
  if (!updatedMetadata.mimeType) {
    return {
      status: "error",
      error: `MIME type is missing in metadata: ${JSON.stringify(updatedMetadata)}`,
    };
  }
  const newFileExt = Internal.mimeTypeToFileExt(updatedMetadata.mimeType);
  const newFilePath = (relativeFilePath.slice(0, -fileExt.length) +
    newFileExt) as `public/${string}`;
  return {
    status: "fix-required",
    metadata: updatedMetadata,
    // On the host the ref was already on. Re-deriving a ref changes what it
    // says about the file, never where it is served from: a Hosted project's
    // file is in R2 and served only at its own address, and moving a ref to
    // another host is a fix of its own (`remote:rewrite-host`).
    ref: Internal.remote.createRemoteRef(remoteRefDataRes.remoteHost, {
      publicProjectId: remoteRefDataRes.projectId,
      coreVersion,
      bucket: remoteRefDataRes.bucket,
      validationHash: nextValidationHash,
      fileHash: fileBufferRes.fileHash,
      filePath: newFilePath,
    }),
  };
}

export function getCachedRemoteFileDir(projectRoot: string) {
  // store in projectRoot/.val/remote-file-cache
  const remoteFileCacheDir = path.join(
    projectRoot,
    ".val",
    "remote-file-cache",
  );
  return remoteFileCacheDir;
}

export function getCachedRemoteFilePath(
  fileExt: string,
  currentFileHash: string,
  remoteFileCacheDir: string,
) {
  const remoteFilePath = path.join(
    remoteFileCacheDir,
    currentFileHash + "." + fileExt,
  );
  return remoteFilePath;
}

/**
 * A remote file's bytes, and the hash they actually have — which is the one a
 * re-derived ref is made from, whatever hash the old ref claimed.
 */
export type ReadRemoteFile = (
  ref: string,
  fileExt: string,
  expectedFileHash: string,
) => Promise<
  | {
      status: "success";
      fileBuffer: Buffer;
      fileHash: string;
      /** Where a download was kept, when it was kept: for error messages. */
      cachedFilePath?: string;
    }
  | {
      status: "error";
      error: string;
    }
>;

export async function getFileBufferFromRemote(
  ref: string,
  fileExt: string,
  currentFileHash: string,
  projectRoot: string,
): ReturnType<ReadRemoteFile> {
  const remoteFileCacheDir = getCachedRemoteFileDir(projectRoot);
  const remoteFilePath = getCachedRemoteFilePath(
    fileExt,
    currentFileHash,
    remoteFileCacheDir,
  );
  try {
    const fileBuffer = await fs.promises.readFile(remoteFilePath);
    const computedFileHash = Internal.remote.getFileHash(fileBuffer);
    if (computedFileHash !== currentFileHash) {
      await fs.promises.unlink(remoteFilePath);
      throw Error(
        `Cached file hash does not match the expected hash: ${computedFileHash} !== ${currentFileHash}`,
      );
    }
  } catch {
    try {
      await fs.promises.mkdir(remoteFileCacheDir, { recursive: true });
      await downloadFileFromRemote(ref, remoteFilePath);
    } catch (err) {
      try {
        // try to delete in case of partial download
        await fs.promises.unlink(remoteFilePath);
      } catch {
        //
      }
      return {
        status: "error",
        error: `Failed to download remote file: ${err instanceof Error ? err.message : "Unknown error"}`,
      };
    }
  }
  const fileBuffer = await fs.promises.readFile(remoteFilePath);
  const computedFileHash = Internal.remote.getFileHash(fileBuffer);
  return {
    status: "success",
    fileBuffer,
    fileHash: computedFileHash,
    cachedFilePath: remoteFilePath,
  };
}

/**
 * Download a remote file to `filePath`, from where its ref says -- and, for a
 * platform ref whose host fails, from the same file on the project's own
 * `valstart.dev` address, which always serves it (`fallbackRefOf`). The bytes
 * from the fallback are checked against the ref's file hash before they are
 * kept: a different host answering is only safe because of that check.
 *
 * Rejects with the FIRST host's error when both fail: that is the one the ref
 * names, and the one a person can recognise.
 */
export async function downloadFileFromRemote(
  ref: string,
  filePath: string,
): ReturnType<typeof downloadFromUrl> {
  try {
    return await downloadFromUrl(ref, filePath);
  } catch (err) {
    const fallback = fallbackRefOf(ref);
    const parsed = Internal.remote.splitRemoteRef(ref);
    if (fallback === null || parsed.status === "error") {
      throw err;
    }
    try {
      const res = await downloadFromUrl(fallback, filePath);
      if (res.status === "error") {
        throw err;
      }
    } catch {
      throw err;
    }
    const bytes = await fs.promises.readFile(filePath);
    if (Internal.remote.getFileHash(bytes) !== parsed.fileHash) {
      await fs.promises.unlink(filePath).catch(() => undefined);
      throw new Error(
        `${ref}. Its host failed, and the file at ${fallback} is not the one the ref names.`,
        { cause: err },
      );
    }
    return { status: "success", filePath };
  }
}

async function downloadFromUrl(
  ref: string,
  filePath: string,
): Promise<
  | {
      status: "success";
      filePath: string;
    }
  | {
      status: "error";
      error: string;
    }
> {
  return new Promise((resolve, reject) => {
    const url = new URL(ref);
    const client = url.protocol === "https:" ? https : http;
    const request = client.get(url, (response) => {
      if (
        response.statusCode &&
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location
      ) {
        // Handle redirects
        return downloadFromUrl(response.headers.location, filePath)
          .then(resolve)
          .catch(reject);
      }

      if (response.statusCode == 404) {
        return reject(
          new Error(
            `${ref}. File not found. The URL is most likely incorrect.`,
          ),
        );
      }
      if (response.statusCode !== 200) {
        return reject(
          new Error(
            `${ref}. Failed to download file. HTTP Status: ${response.statusCode}`,
          ),
        );
      }

      const writeStream = fs.createWriteStream(filePath);
      response.pipe(writeStream);

      writeStream.on("finish", () =>
        resolve({
          status: "success",
          filePath,
        }),
      );
      writeStream.on("error", (err) =>
        reject(new Error(`${ref}. Error writing file: ${err.message}`)),
      );
    });

    request.on("error", (err) =>
      reject(new Error(`${ref}. Download error: ${err.message}`)),
    );
    request.end();
  });
}
