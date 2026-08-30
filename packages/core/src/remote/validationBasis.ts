import { getSHA256Hash } from "../getSha256";
import { SerializedFileSchema } from "../schema/file";
import { SerializedImageSchema } from "../schema/image";

/**
 * The validation basis is used in remote refs to determine if the remote content needs to be re-validated.
 *
 * If the validation basis changes, we need to re-validate the remote content.
 *
 * NOTE: We do not care if the file path is different as long as the extension is the same.
 *       This way we can rename a file, without having to re-validate it.
 *       The version is outside of the validation hash, so that it is possible to manually fix the version without having to re-validate.
 */
export function getValidationBasis(
  coreVersion: string,
  schema: SerializedImageSchema | SerializedFileSchema,
  fileExt: string,
  metadata: Record<string, unknown> | undefined,
  fileHash: string,
) {
  const metadataValidationBasis = `${metadata?.width || ""}${metadata?.height || ""}${metadata?.mimeType}`;
  const options: Record<string, unknown> = { ...schema.options };
  // Ignore options that do not affect the validation basis below:
  // `encode` says how the bytes were PRODUCED in the browser, not whether the
  // bytes that arrived are valid. Leaving it in would mean that changing a
  // quality setting re-validates every remote file in the project.
  delete options.encode;
  const schemaValidationBasis = {
    type: schema.type,
    opt: schema.opt,
    options,
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
  textEncoder: TextEncoder,
) {
  return getSHA256Hash(
    textEncoder.encode(
      getValidationBasis(coreVersion, schema, fileExt, metadata, fileHash),
    ),
  ).slice(0, 4); // we do not need a lot of bits for the validation hash, since it is only used to identify the validation basis
}
