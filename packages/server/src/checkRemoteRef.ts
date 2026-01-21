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

const textEncoder = new TextEncoder();
export async function checkRemoteRef(
  remoteHost: string,
  ref: string,
  projectRoot: string,
  schema: SerializedImageSchema | SerializedFileSchema,
  metadata: Record<string, unknown> | undefined,
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
  if (!relativeFilePath.startsWith("public/val/")) {
    return {
      status: "error",
      error: `File path must be within the public/val/ directory (e.g. public/val/path/to/file.txt). Got: ${relativeFilePath}`,
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
  const fileBufferRes = await getFileBufferFromRemote(
    ref,
    fileExt,
    remoteRefDataRes.fileHash,
    projectRoot,
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
      error: `Failed to extract metadata from remote file: ${err instanceof Error ? err.message : "Unknown error"}. Cached file: ${fileBufferRes.cachedFilePath}`,
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
    newFileExt) as `public/val/${string}`;
  return {
    status: "fix-required",
    metadata: updatedMetadata,
    ref: Internal.remote.createRemoteRef(remoteHost, {
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

async function getFileBufferFromRemote(
  ref: string,
  fileExt: string,
  currentFileHash: string,
  projectRoot: string,
): Promise<
  | {
      status: "success";
      fileBuffer: Buffer;
      fileHash: string;
      cachedFilePath: string;
    }
  | {
      status: "error";
      error: string;
    }
> {
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

export async function downloadFileFromRemote(
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
        return downloadFileFromRemote(response.headers.location, filePath)
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
