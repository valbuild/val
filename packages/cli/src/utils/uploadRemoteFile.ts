import {
  Internal,
  RemoteRef,
  SerializedFileSchema,
  SerializedImageSchema,
} from "@valbuild/core";
import { promises as fs } from "fs";
import path from "path";
import { getVersions } from "../getVersions";

const textEncoder = new TextEncoder();
export async function uploadRemoteFile(
  publicProjectId: string,
  root: string,
  filePath: string,
  schema: SerializedImageSchema | SerializedFileSchema,
  metadata: Record<string, unknown> | undefined,
  pat: string,
): Promise<
  | {
      success: true;
      ref: string;
    }
  | {
      success: false;
      error: string;
    }
> {
  const text = await fs.readFile(filePath, "utf-8");
  const fileHash = Internal.getSHA256Hash(textEncoder.encode(text)).slice(
    0,
    12, // 12 hex characters = 6 bytes = 48 bits = 2^48 = 281474976710656 possibilities or 1 in 281474976710656 or using birthday problem estimate with 10K files: p = (k, n) => (k*k)/(2x2**n) and p(10_000,12*4) = 1.7763568394002505e-7 chance of collision which should be good enough
  );
  const relativeFilePath = path
    .relative(root, filePath)
    .split(path.sep)
    .join("/");
  const fileExt = path.extname(filePath).slice(1);
  const coreVersion = (await getVersions()).coreVersion || "unknown";
  const validationHash = getValidationHash(
    coreVersion || "unknown",
    schema,
    fileExt,
    metadata,
    fileHash,
  );
  // NOTE: the core version is part of the validation hash, but it is also in the uri to make it easier to understand which version the remote file was validated against.
  const ref: RemoteRef = `https://remote.val.build/file/p/${publicProjectId}/v/${coreVersion}/h/${validationHash}/f/${fileHash}/p/${relativeFilePath as `public/val/${string}`}`;
  console.error("FAKE UPLOAD", ref);
  return {
    success: true,
    ref,
  };
}

/**
 * If the validation basis changes, we need to re-validate the remote content.
 *
 * NOTE: We do not care if the file path is different as long as the extension is the same.
 *       This way we can rename a file, without having to re-validate it.
 *       The version is outside of the validation hash, so that it is possible to manually fix the version without having to re-validate.
 */
function getValidationBasis(
  coreVersion: string,
  schema: SerializedImageSchema | SerializedFileSchema,
  fileExt: string,
  metadata: Record<string, unknown> | undefined,
  fileHash: string,
) {
  const metadataValidationBasis = `${metadata?.width}${metadata?.height}${metadata?.mimeType}`;
  const schemaValidationBasis = {
    type: schema.type,
    opt: schema.opt,
    options: {
      ...schema.options,
      // Ignore options that are does not affect the validation basis below:
      // Currently we do not have any options that can be ignored.
    },
  };
  return (
    coreVersion +
    JSON.stringify(schemaValidationBasis) +
    fileExt +
    metadataValidationBasis +
    fileHash
  );
}

export function getValidationHash(
  coreVersion: string,
  schema: SerializedImageSchema | SerializedFileSchema,
  fileExt: string,
  metadata: Record<string, unknown> | undefined,
  fileHash: string,
) {
  return Internal.getSHA256Hash(
    textEncoder.encode(
      getValidationBasis(coreVersion, schema, fileExt, metadata, fileHash),
    ),
  ).slice(0, 6); // we do not need a lot of bits for the validation hash, since it is only used to identify the validation basis
}
