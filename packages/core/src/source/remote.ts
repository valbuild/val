// NOTE: the segments must match the ref built by createRemoteRef below and the RegEx in splitRemoteRef.
export type RemoteRef =
  `${string}/file/p/${string}/b/${string}/v/${string}/h/${string}/f/${string}/p/public/${string}`;

export function createRemoteRef(
  remoteHost: string,
  {
    publicProjectId,
    coreVersion,
    validationHash,
    fileHash,
    filePath,
    bucket,
  }: {
    publicProjectId: string;
    coreVersion: string;
    validationHash: string;
    fileHash: string;
    filePath: `public/${string}`;
    bucket: string;
  },
): RemoteRef {
  // NOTE: the core version is part of the validation hash, but it is also in the uri to make it easier to understand which version the remote file was validated against.
  return `${remoteHost}/file/p/${publicProjectId}/b/${bucket}/v/${coreVersion}/h/${validationHash}/f/${fileHash}/p/${filePath}`;
}
