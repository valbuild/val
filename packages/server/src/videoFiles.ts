import fs from "fs";
import path from "path";
import { Internal } from "@valbuild/core";
import { mapHlsUris } from "./hls";

/**
 * Every file a video value names, as refs (`/public/…`, or a remote URL as
 * written): the video, its poster, each caption track — and, for a LOCAL HLS
 * stream, every file its playlists name, followed from the master down through
 * each media playlist to the segment files, init sections and audio tracks.
 *
 * Followed rather than "everything in the master's directory": the Studio
 * gives each stream a directory of its own, but nothing stops a hand-placed
 * `/public/val/clip.m3u8`, and the directory of THAT one is every file in
 * `/public/val`. A file in a stream's directory that no playlist names is not
 * used by the stream either, so calling it unused is right.
 *
 * A remote stream's playlists are on the content host, so its master is all
 * that is named here.
 *
 * The one place that answers this, so `list-unused-files` and anything else
 * asking "is this file used" agree on what a video holds.
 */
export function filesOfVideo(
  video: unknown,
  options: {
    projectRoot: string;
    readFile?: (absolutePath: string) => Buffer | undefined;
  },
): string[] {
  if (!isObject(video) || typeof video.path !== "string") {
    return [];
  }
  const refs = new Set<string>([video.path]);
  if (isObject(video.poster) && typeof video.poster.path === "string") {
    refs.add(video.poster.path);
  }
  if (Array.isArray(video.captions)) {
    for (const track of video.captions) {
      if (isObject(track) && typeof track.path === "string") {
        refs.add(track.path);
      }
    }
  }
  const mimeType =
    typeof video.mimeType === "string" ? video.mimeType : undefined;
  if (
    !Internal.isRemoteMediaPath(video.path) &&
    Internal.media.isHlsVideo({ path: video.path, mimeType })
  ) {
    const readFile = options.readFile ?? readFileOrUndefined;
    const pending = [video.path.split("?")[0]];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const playlist = pending.pop()!;
      if (visited.has(playlist)) {
        continue;
      }
      visited.add(playlist);
      const text = readFile(
        path.join(options.projectRoot, ...playlist.split("/")),
      )?.toString("utf-8");
      if (text === undefined) {
        continue;
      }
      mapHlsUris(text, (uri) => {
        const ref = localRefOf(uri, playlist);
        if (ref !== undefined) {
          refs.add(ref);
          if (ref.toLowerCase().endsWith(".m3u8")) {
            pending.push(ref);
          }
        }
        return uri;
      });
    }
  }
  return [...refs];
}

/** A playlist URI as a local ref, when it is relative; otherwise undefined. */
function localRefOf(uri: string, playlist: string): string | undefined {
  if (/^[a-z][a-z0-9+.-]*:/i.test(uri) || uri.startsWith("/")) {
    return undefined;
  }
  const relative = uri.split(/[?#]/)[0];
  if (relative === "") {
    return undefined;
  }
  return path.posix.join(path.posix.dirname(playlist), relative);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readFileOrUndefined(absolutePath: string): Buffer | undefined {
  try {
    return fs.readFileSync(absolutePath);
  } catch {
    return undefined;
  }
}
