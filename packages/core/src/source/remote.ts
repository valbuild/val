import { VAL_EXTENSION } from ".";
import { ValConfig } from "../initVal";
import { FILE_REF_PROP } from "./file";

/**
 * A remote source represents data that is not stored locally.
 */
export type RemoteSource<
  Metadata extends Record<string, string | number> | undefined =
    | Record<string, string | number>
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

type RemoteRef = `remote://${string}/${string}/${string}`;