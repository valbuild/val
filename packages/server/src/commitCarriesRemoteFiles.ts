import type { PreparedCommit } from "./ValOps";

/**
 * Does saving this commit upload a file to Val's remote host?
 *
 * The question `/save` asks before it reads remote credentials. It used to ask
 * the SCHEMAS instead -- "is any of them remote?" -- and with
 * `files: { remote: true }` every media schema is, so every save needed a
 * `val login` token or an api key: a corrected typo included. Only a remote
 * FILE is uploaded, so only a commit carrying one needs credentials.
 */
export function commitCarriesRemoteFiles(
  preparedCommit: Pick<PreparedCommit, "patchedBinaryFilesDescriptors">,
): boolean {
  return Object.values(preparedCommit.patchedBinaryFilesDescriptors).some(
    (descriptor) => descriptor.remote,
  );
}

/** Does this commit carry any file at all, remote or local? */
export function commitCarriesFiles(
  preparedCommit: Pick<PreparedCommit, "patchedBinaryFilesDescriptors">,
): boolean {
  return Object.keys(preparedCommit.patchedBinaryFilesDescriptors).length > 0;
}
