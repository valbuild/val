/**
 * The URIs an HLS playlist names, and a way to swap them.
 *
 * A playlist names other files in two places: on a line of its own (a media
 * playlist in a master, a segment in a media playlist) and inside a `URI="…"`
 * attribute (`#EXT-X-MAP` for an init segment, `#EXT-X-MEDIA` for an audio
 * rendition). Both are rewritten; nothing else in the text is touched, so the
 * byte ranges and the timing survive exactly.
 *
 * The Studio needs this for REMOTE videos: the content host stores files by
 * hash, so `playlist-1.m3u8` next to `master.m3u8` is not a URL that resolves
 * there, and every name has to become the ref of the file it names. The
 * server has its own copy of the same idea for drafts (`/files` rewrites a
 * served playlist so its segments carry the `patch_id`).
 */
export function mapPlaylistUris(
  playlist: string,
  map: (uri: string) => string,
): string {
  return playlist
    .split(/(\r?\n)/)
    .map((line) => {
      if (line === "\n" || line === "\r\n") {
        return line;
      }
      const trimmed = line.trim();
      if (trimmed === "") {
        return line;
      }
      if (trimmed.startsWith("#")) {
        return line.replace(
          /URI="([^"]*)"/g,
          (_, uri: string) => `URI="${map(uri)}"`,
        );
      }
      return map(trimmed);
    })
    .join("");
}

/** Every URI a playlist names, in order, without duplicates. */
export function playlistUris(playlist: string): string[] {
  const uris: string[] = [];
  mapPlaylistUris(playlist, (uri) => {
    if (!uris.includes(uri)) {
      uris.push(uri);
    }
    return uri;
  });
  return uris;
}

export function isPlaylistPath(path: string): boolean {
  return path.toLowerCase().endsWith(".m3u8");
}
