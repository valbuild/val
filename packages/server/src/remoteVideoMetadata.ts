import { Internal, type VideoMetadata } from "@valbuild/core";
import { extractFromByteSource, readHlsMetadata } from "./extractMetadata";
import type { ByteSource } from "./isoBmff";

/**
 * A remote video's size and length, read over HTTP without downloading it.
 *
 * The parsers (`isoBmff.ts`, `ebml.ts`) are synchronous and ask a
 * {@link ByteSource} for the few header bytes they need. Here that source is
 * a cache of byte ranges fetched with `Range` requests: when the parser asks
 * for bytes the cache does not hold, the read throws {@link NeedBytes}, the
 * missing range is fetched, and the parser runs again from the start. Parsing
 * headers is microseconds and fetching is milliseconds, so re-running is the
 * cheap side of that trade — and it keeps ONE parser for files on disk and
 * files on Val Remote, rather than an async copy of each.
 *
 * An mp4 with `moov` first costs one request; one with `moov` after `mdat`
 * costs about three (the start, the box header past `mdat`, and `moov`
 * itself), however large the file. An HLS stream is its master playlist and
 * one media playlist.
 */

/** How much to fetch past what was asked for: box headers come in runs. */
const READ_AHEAD = 64 * 1024;
/** A parser that needs more fetches than this is not reading headers. */
const MAX_FETCHES = 16;

export type RangeFetch = (
  url: string,
  init: { headers: Record<string, string> },
) => Promise<Response>;

/** Thrown by a cached read that needs bytes not fetched yet. */
class NeedBytes {
  constructor(
    readonly offset: number,
    readonly length: number,
  ) {}
}

/**
 * Read `url`'s metadata. `nameForType` is the file name its type is read off —
 * for a remote ref, the `/public/...` path inside it, since the ref's own URL
 * ends in the same name but is not where a reader would look for it.
 */
export async function extractVideoMetadataFromUrl(
  url: string,
  nameForType: string,
  fetchImpl: RangeFetch = fetch,
): Promise<VideoMetadata> {
  if (nameForType.split("?")[0].toLowerCase().endsWith(".m3u8")) {
    const master = await fetchText(url, fetchImpl);
    return readHlsMetadata(master, (uri) =>
      fetchText(new URL(uri, url).toString(), fetchImpl).catch(() => undefined),
    );
  }
  const cache = new RangeCache(url, fetchImpl);
  for (let fetches = 0; ; fetches++) {
    const source = await cache.source();
    try {
      return extractFromByteSource(nameForType, source);
    } catch (err) {
      if (!(err instanceof NeedBytes)) {
        throw err;
      }
      if (fetches >= MAX_FETCHES) {
        throw new Error(
          `Reading the headers of ${url} took more than ${MAX_FETCHES} requests`,
          { cause: err },
        );
      }
      await cache.fetch(err.offset, err.length);
    }
  }
}

/** The local `/public/...` path a remote ref names, for its file type. */
export function nameForTypeOf(ref: string): string {
  const split = Internal.remote.splitRemoteRef(ref);
  return split.status === "success" ? `/${split.filePath}` : ref;
}

async function fetchText(url: string, fetchImpl: RangeFetch): Promise<string> {
  const res = await fetchImpl(url, { headers: {} });
  if (!res.ok) {
    throw new Error(`Could not read ${url}: HTTP ${res.status}`);
  }
  return res.text();
}

class RangeCache {
  /** Fetched ranges, as [start, bytes]. Few, so a list is enough. */
  private chunks: [number, Buffer][] = [];
  private size: number | undefined;

  constructor(
    private readonly url: string,
    private readonly fetchImpl: RangeFetch,
  ) {}

  /** A source over what is cached, after fetching the start if nothing is. */
  async source(): Promise<ByteSource> {
    if (this.size === undefined) {
      await this.fetch(0, READ_AHEAD);
    }
    const size = this.size ?? 0;
    return {
      size,
      read: (offset, length) => {
        const end = Math.min(offset + length, size);
        if (end <= offset) {
          return Buffer.alloc(0);
        }
        for (const [start, bytes] of this.chunks) {
          if (start <= offset && end <= start + bytes.length) {
            return bytes.subarray(offset - start, end - start);
          }
        }
        throw new NeedBytes(offset, end - offset);
      },
    };
  }

  async fetch(offset: number, length: number): Promise<void> {
    const last = offset + Math.max(length, READ_AHEAD) - 1;
    const res = await this.fetchImpl(this.url, {
      headers: { Range: `bytes=${offset}-${last}` },
    });
    if (res.status === 200) {
      // The server ignored the range and sent the whole file. That answers
      // every read there will be.
      const whole = Buffer.from(await res.arrayBuffer());
      this.chunks = [[0, whole]];
      this.size = whole.length;
      return;
    }
    if (res.status !== 206) {
      throw new Error(`Could not read ${this.url}: HTTP ${res.status}`);
    }
    // `bytes 0-65535/1234567`: where the bytes start, and how big the file is.
    const range = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(
      res.headers.get("content-range") ?? "",
    );
    if (!range) {
      throw new Error(
        `Could not read ${this.url}: a partial answer without a Content-Range`,
      );
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    if (range[3] !== "*") {
      this.size = Number(range[3]);
    } else if (this.size === undefined) {
      throw new Error(`Could not read ${this.url}: its size is not known`);
    }
    this.chunks.push([Number(range[1]), bytes]);
  }
}
