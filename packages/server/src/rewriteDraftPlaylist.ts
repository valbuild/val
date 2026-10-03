import path from "path";
import { Internal } from "@valbuild/core";
import { mapHlsUris } from "./hls";

/**
 * An HLS playlist served as a DRAFT, with every URI in it pointed at the draft
 * endpoint.
 *
 * Why this exists: a draft is served from `/api/val/files<path>?patch_id=…`,
 * and a player resolves the playlist's URIs against that URL. A RELATIVE URI
 * (`720p.m3u8`, how a local stream is written so it works wherever the
 * directory is served from) resolves to `/api/val/files/public/val/x/720p.m3u8`
 * — the query string is dropped by URL resolution, so the `patch_id` is gone,
 * and the endpoint looks for a PUBLISHED file that does not exist yet. An
 * ABSOLUTE remote ref (how a remote stream is written, because the content host
 * addresses files by hash) points at the content host, which has nothing until
 * publish. Either way the master plays and nothing it names does.
 *
 * So each URI is rewritten to the URL `Internal.mediaUrl` gives the same file
 * as a draft. Every file of one upload is in the same patch, so they share the
 * `patch_id` the playlist itself was requested with.
 *
 * What is NOT rewritten, and why:
 * - an absolute URL that is not a Val remote ref (another host's stream): it
 *   was never in a patch;
 * - a root-relative URI (`/val/x/720p.mp4`): the Studio never writes one, and
 *   it already names a published URL, so it is not this function's to guess at.
 *
 * Pure, and the whole rule: the `/files` route calls it and nothing else.
 */
export function rewriteDraftPlaylist(
  playlist: string,
  options: {
    /** The playlist's own file path, as served: `/public/val/x_abc12/master.m3u8`. */
    playlistPath: string;
    patchId: string;
    /** The playlist was requested as a remote draft (`remote=true`). */
    remote: boolean;
  },
): string {
  return mapHlsUris(playlist, (uri) => rewriteUri(uri, options));
}

function rewriteUri(
  uri: string,
  {
    playlistPath,
    patchId,
    remote,
  }: { playlistPath: string; patchId: string; remote: boolean },
): string {
  if (Internal.remote.splitRemoteRef(uri).status === "success") {
    return Internal.mediaUrl({ path: uri, patch_id: patchId });
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(uri) || uri.startsWith("/")) {
    // Another scheme (https:, data:, …), protocol-relative or root-relative.
    return uri;
  }
  // The query and fragment of a relative URI address the published file; the
  // draft endpoint has its own query, and fragments do not reach a server.
  const relative = uri.split(/[?#]/)[0];
  if (relative === "") {
    return uri;
  }
  // `join` from an absolute directory stays absolute: `..` stops at the root.
  const resolved = path.posix.join(path.posix.dirname(playlistPath), relative);
  return `/api/val/files${resolved}?patch_id=${patchId}${remote ? "&remote=true" : ""}`;
}

/** Whether a served file is an HLS playlist, by its extension. */
export function isHlsPlaylistPath(filePath: string): boolean {
  return filePath.split("?")[0].toLowerCase().endsWith(".m3u8");
}
