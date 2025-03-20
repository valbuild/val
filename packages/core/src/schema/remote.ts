import { FILE_REF_PROP } from "../source/file";
import { RemoteSource } from "../source/remote";

export const VAL_REMOTE_HOST =
  process.env["VAL_REMOTE_HOST"] || "http://localhost:4000";

export function convertRemoteSource<
  Metadata extends { readonly [key: string]: string | number } | undefined =
    | { readonly [key: string]: string | number }
    | undefined,
>(src: RemoteSource<Metadata>): { url: string; metadata?: Metadata } {
  return {
    url:
      src[FILE_REF_PROP] + (src.patch_id ? `?patch_id=${src["patch_id"]}` : ""),
    metadata: src.metadata,
  };
}
