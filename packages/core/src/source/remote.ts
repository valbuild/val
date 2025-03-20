import { VAL_EXTENSION } from ".";
import { ValConfig } from "../initVal";
import { VAL_REMOTE_HOST } from "../schema/remote";
import { FILE_REF_PROP } from "./file";

/**
 * A remote source represents data that is not stored locally.
 */
export type RemoteSource<
  Metadata extends Record<string, unknown> | undefined =
    | Record<string, unknown>
    | undefined,
> = {
  readonly [FILE_REF_PROP]: string;
  readonly [VAL_EXTENSION]: "remote";
  readonly metadata?: Metadata;
  readonly patch_id?: string;
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const initRemote = (config?: ValConfig) => {
  function remote<Metadata extends Record<string, string | number> | undefined>(
    ref: RemoteRef,
    metadata?: Metadata,
  ): RemoteSource<Metadata> {
    return {
      [FILE_REF_PROP]: ref,
      [VAL_EXTENSION]: "remote",
      metadata,
    } as RemoteSource<Metadata>;
  }
  return remote;
};

export type RemoteRef =
  `${string}/file/p/${string}/v/${string}/h/${string}/f/${string}/p/public/val/${string}`;

export function createRemoteRef({
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
  filePath: `public/val/${string}`;
  bucket: string;
}): RemoteRef {
  // NOTE: the core version is part of the validation hash, but it is also in the uri to make it easier to understand which version the remote file was validated against.
  return `${VAL_REMOTE_HOST}/file/p/${publicProjectId}/b/${bucket}/v/${coreVersion}/h/${validationHash}/f/${fileHash}/p/${filePath}`;
}
