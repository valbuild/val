import { Json } from "..";
import { splitRemoteRef } from "../remote/splitRemoteRef";
import { FILE_REF_PROP } from "../source/file";
import { RemoteSource } from "../source/remote";

export const VAL_REMOTE_HOST = "http://localhost:4000";

export function convertRemoteSource<
  Metadata extends { readonly [key: string]: Json } | undefined =
    | { readonly [key: string]: Json }
    | undefined,
>(src: RemoteSource<Metadata>): { url: string; metadata?: Metadata } {
  if (src?.patch_id) {
    const splitRemoteRefDataRes = splitRemoteRef(src[FILE_REF_PROP]);
    if (splitRemoteRefDataRes.status === "success") {
      return {
        url:
          "/api/val/files/" +
          splitRemoteRefDataRes.filePath +
          `?patch_id=${src["patch_id"]}&remote=true`,
        metadata: src.metadata,
      };
    } else {
      console.warn(
        `Internal Val error: failed to split remote ref: ${src[FILE_REF_PROP]}. The data format is different than what is expected. Check Val versions for mismatches.`,
        splitRemoteRefDataRes.error,
      );
    }
  }
  return {
    url: src[FILE_REF_PROP],
    metadata: src.metadata,
  };
}
