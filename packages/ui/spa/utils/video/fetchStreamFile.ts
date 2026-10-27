import { Internal } from "@valbuild/core";
import type { FetchedFile } from "./renameVideo";

/**
 * One file of a stream, read back from where the Studio plays it — the way
 * `readStream` asks for each. The type is the response's, then the name's:
 * a dev server that answers `.m3u8` as `text/plain` still gives a playlist.
 */
export async function fetchStreamFile(url: string): Promise<FetchedFile> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Could not read ${url}: HTTP ${res.status}`);
  }
  return {
    bytes: new Uint8Array(await res.arrayBuffer()),
    mimeType:
      res.headers.get("content-type")?.split(";")[0] ||
      Internal.filenameToMimeType(new URL(url).pathname) ||
      "application/octet-stream",
  };
}
