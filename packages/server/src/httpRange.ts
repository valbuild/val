/**
 * The `Range` request header, for the one route that serves bytes a player
 * seeks in: `/files`.
 *
 * A `<video>` element asks for ranges as a matter of course, and Safari will
 * not play a video at all from a server that does not answer them. An HLS
 * stream whose segments are byte ranges of one file (`#EXT-X-BYTERANGE`) asks
 * for nothing else.
 *
 * Only a single range is honoured. A multi-range request (`bytes=0-1,5-6`) is
 * answered with the whole file, which RFC 9110 permits, and nothing that plays
 * media sends one. A header that does not parse is ignored the same way.
 */
export type RequestedRange =
  /** No range, or one this server chooses to ignore: send the whole body. */
  | { kind: "none" }
  /** Send `start` to `end`, both INCLUSIVE, as a 206. */
  | { kind: "range"; start: number; end: number }
  /** A well-formed range that starts past the end: a 416. */
  | { kind: "unsatisfiable" };

export function parseRangeHeader(
  header: string | undefined | null,
  size: number,
): RequestedRange {
  if (!header) {
    return { kind: "none" };
  }
  const match = /^\s*bytes\s*=\s*(.*)$/i.exec(header);
  if (!match) {
    return { kind: "none" };
  }
  const spec = match[1].trim();
  if (spec.includes(",")) {
    return { kind: "none" };
  }
  const suffix = /^-(\d+)$/.exec(spec);
  if (suffix) {
    const length = Number(suffix[1]);
    if (length === 0 || size === 0) {
      return { kind: "unsatisfiable" };
    }
    return { kind: "range", start: Math.max(0, size - length), end: size - 1 };
  }
  const bounded = /^(\d+)-(\d*)$/.exec(spec);
  if (!bounded) {
    return { kind: "none" };
  }
  const start = Number(bounded[1]);
  const end = bounded[2] === "" ? undefined : Number(bounded[2]);
  if (end !== undefined && end < start) {
    // Syntactically invalid (RFC 9110 §14.1.1): ignored, not refused.
    return { kind: "none" };
  }
  if (start >= size) {
    return { kind: "unsatisfiable" };
  }
  return { kind: "range", start, end: Math.min(end ?? size - 1, size - 1) };
}
