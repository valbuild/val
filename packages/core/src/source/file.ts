/**
 * What Val computes from a file's bytes.
 *
 * Not part of the source any more — a media source carries these fields
 * directly — but still the unit the upload and `--fix` pipelines work in:
 * "here is what reading this file told us".
 */
export type FileMetadata = {
  mimeType?: string;
};
