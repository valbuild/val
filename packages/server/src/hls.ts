/**
 * The little of HLS (RFC 8216) the server has to read: the variants of a
 * master playlist, the segment durations of a media playlist, and every URI a
 * playlist names.
 *
 * Deliberately a line scanner rather than a parser. The playlists Val reads are
 * the ones the Studio wrote, and the questions asked of them are small — "how
 * big is the largest rendition", "how long is it", "where does each URI
 * point" — so a full model of the format would be code nothing exercises.
 */

/** One `#EXT-X-STREAM-INF` entry of a master playlist. */
export type HlsVariant = {
  /** The media playlist, exactly as written in the master (often relative). */
  uri: string;
  bandwidth?: number;
  width?: number;
  height?: number;
};

/** Lines of a playlist, with Windows line endings tolerated. */
function linesOf(text: string): string[] {
  return text.split(/\r?\n/);
}

/**
 * The attributes of a tag, e.g. the part after `#EXT-X-STREAM-INF:`.
 *
 * Quoted values may contain commas (`CODECS="avc1.64001f,mp4a.40.2"`), which
 * is why this is not a `split(",")`. Quotes are removed from the values.
 */
export function parseHlsAttributes(list: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(list)) !== null) {
    const [, name, rawValue] = match;
    attributes[name] =
      rawValue.startsWith('"') && rawValue.endsWith('"')
        ? rawValue.slice(1, -1)
        : rawValue.trim();
  }
  return attributes;
}

/** Whether a playlist is a master (multivariant) playlist. */
export function isHlsMasterPlaylist(text: string): boolean {
  return linesOf(text).some((line) =>
    line.trim().startsWith("#EXT-X-STREAM-INF:"),
  );
}

/** The variants of a master playlist, in the order they are listed. */
export function parseHlsMasterVariants(text: string): HlsVariant[] {
  const variants: HlsVariant[] = [];
  let pending: Omit<HlsVariant, "uri"> | null = null;
  for (const rawLine of linesOf(text)) {
    const line = rawLine.trim();
    if (line === "") {
      continue;
    }
    if (line.startsWith("#EXT-X-STREAM-INF:")) {
      const attributes = parseHlsAttributes(
        line.slice("#EXT-X-STREAM-INF:".length),
      );
      const variant: Omit<HlsVariant, "uri"> = {};
      const bandwidth = Number(attributes["BANDWIDTH"]);
      if (attributes["BANDWIDTH"] !== undefined && Number.isFinite(bandwidth)) {
        variant.bandwidth = bandwidth;
      }
      const resolution = /^(\d+)x(\d+)$/.exec(attributes["RESOLUTION"] ?? "");
      if (resolution) {
        variant.width = Number(resolution[1]);
        variant.height = Number(resolution[2]);
      }
      pending = variant;
      continue;
    }
    if (line.startsWith("#")) {
      continue;
    }
    // The URI line that follows a STREAM-INF tag belongs to it.
    if (pending) {
      variants.push({ ...pending, uri: line });
      pending = null;
    }
  }
  return variants;
}

/**
 * The variant whose dimensions describe the video: the largest picture, and
 * among equally large ones the highest bandwidth. `undefined` when no variant
 * declares a `RESOLUTION`.
 */
export function largestHlsVariant(
  variants: HlsVariant[],
): (HlsVariant & { width: number; height: number }) | undefined {
  let best: (HlsVariant & { width: number; height: number }) | undefined;
  for (const variant of variants) {
    const { width, height } = variant;
    if (width === undefined || height === undefined) {
      continue;
    }
    if (
      !best ||
      width * height > best.width * best.height ||
      (width * height === best.width * best.height &&
        (variant.bandwidth ?? 0) > (best.bandwidth ?? 0))
    ) {
      best = { ...variant, width, height };
    }
  }
  return best;
}

/**
 * The sum of a media playlist's `#EXTINF` durations, in seconds, or
 * `undefined` when it has none (a master playlist, or not a playlist).
 */
export function sumHlsSegmentDurations(text: string): number | undefined {
  let total = 0;
  let found = false;
  for (const rawLine of linesOf(text)) {
    const line = rawLine.trim();
    if (!line.startsWith("#EXTINF:")) {
      continue;
    }
    const seconds = Number.parseFloat(line.slice("#EXTINF:".length));
    if (Number.isFinite(seconds)) {
      total += seconds;
      found = true;
    }
  }
  return found ? total : undefined;
}

/**
 * Rewrite every URI a playlist names, leaving everything else byte for byte.
 *
 * URIs are the non-comment lines (segments, variant playlists) and the `URI`
 * attribute of tags such as `#EXT-X-MAP` and `#EXT-X-MEDIA`. Line endings are
 * kept as they were.
 */
export function mapHlsUris(text: string, map: (uri: string) => string): string {
  return text
    .split(/(\r?\n)/)
    .map((part) => {
      if (part === "\n" || part === "\r\n") {
        return part;
      }
      const trimmed = part.trim();
      if (trimmed === "") {
        return part;
      }
      if (trimmed.startsWith("#")) {
        // Only an attribute that is exactly `URI` — preceded by the tag's
        // colon or a comma — and not, say, a `KEYFORMAT-URI` lookalike.
        return part.replace(
          /([:,]\s*)URI="([^"]*)"/g,
          (_match, before: string, uri: string) => `${before}URI="${map(uri)}"`,
        );
      }
      const leading = part.slice(0, part.indexOf(trimmed));
      const trailing = part.slice(part.indexOf(trimmed) + trimmed.length);
      return `${leading}${map(trimmed)}${trailing}`;
    })
    .join("");
}
