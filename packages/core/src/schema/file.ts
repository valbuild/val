import { Json } from "../Json";
import { FILE_REF_PROP, FileSource } from "../source/file";

export function convertFileSource<
  Metadata extends { readonly [key: string]: Json } | undefined =
    | { readonly [key: string]: Json }
    | undefined
>(src: FileSource<Metadata>): { url: string; metadata?: Metadata } {
  // TODO: /public should be configurable
  if (!src[FILE_REF_PROP].startsWith("/public")) {
    return {
      url: src[FILE_REF_PROP] + `?sha256=${src.metadata?.sha256}`,
      metadata: src.metadata,
    };
  }

  return {
    url:
      src[FILE_REF_PROP].slice("/public".length) +
      `?sha256=${src.metadata?.sha256}`,
    metadata: src.metadata,
  };
}
