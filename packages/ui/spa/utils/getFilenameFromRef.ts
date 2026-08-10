import { Internal } from "@valbuild/core";

/**
 * Resolves a file ref (local path or remote URL) to a clean local-style path.
 */
function cleanRefPath(ref: string): string {
  const remoteRefRes = Internal.remote.splitRemoteRef(ref);
  return remoteRefRes.status === "success" ? `/${remoteRefRes.filePath}` : ref;
}

const PUBLIC_PREFIX = "/public";

/**
 * Strips the standard `/public` prefix from a clean path. Only strips when
 * `/public` is an actual path segment, so `/publicity/foo.png` is left alone.
 */
function stripPublicPrefix(cleanPath: string): string {
  if (cleanPath === PUBLIC_PREFIX) {
    return "";
  }
  return cleanPath.startsWith(`${PUBLIC_PREFIX}/`)
    ? cleanPath.slice(PUBLIC_PREFIX.length)
    : cleanPath;
}

/**
 * Extract a human-readable filename from a file ref (local path or remote URL).
 * Handles both remote refs (via splitRemoteRef) and plain `/public/...` paths.
 */
export function getFilenameFromRef(ref: string): string {
  const cleanPath = cleanRefPath(ref);
  return cleanPath.split("/").pop() || cleanPath;
}

/**
 * Parse a file ref into its constituent parts: a clean path, filename, and
 * folder (the path relative to `/public`).
 *
 * The `folder` strips the standard `/public` prefix so it shows a
 * concise location like `/images` instead of `/public/images`.
 */
export function getRefParts(ref: string): {
  cleanPath: string;
  filename: string;
  folder: string;
} {
  const cleanPath = cleanRefPath(ref);
  const filename = cleanPath.split("/").pop() || cleanPath;
  const folder = stripPublicPrefix(cleanPath).replace(/\/[^/]+$/, "") || "/";
  return { cleanPath, filename, folder };
}
