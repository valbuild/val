import { FILE_REF_PROP } from "../source/file";
import { RemoteSource } from "../source/remote";

export const VAL_REMOTE_HOST =
  process.env["VAL_REMOTE_HOST"] || "https://remote.val.build";

export function convertRemoteSource<
  Metadata extends { readonly [key: string]: string | number } | undefined =
    | { readonly [key: string]: string | number }
    | undefined,
>(src: RemoteSource<Metadata>): { url: string; metadata?: Metadata } {
  if (!src[FILE_REF_PROP].startsWith("remote://")) {
    return {
      url:
        src[FILE_REF_PROP] +
        (src.patch_id ? `?patch_id=${src["patch_id"]}` : ""),
      metadata: src.metadata,
    };
  }

  if (src.patch_id) {
    return {
      url:
        VAL_REMOTE_HOST +
        src[FILE_REF_PROP].slice("remote://".length) +
        `?patch_id=${src["patch_id"]}`,
      metadata: src.metadata,
    };
  }
  return {
    url: VAL_REMOTE_HOST + src[FILE_REF_PROP].slice("remote://".length),
    metadata: src.metadata,
  };
}
