import { Internal } from "@valbuild/core";

/**
 * Resolves a file ref (local path or remote URL) to a clean local-style path.
 */
function cleanRefPath(ref: string): string {
  const remoteRefRes = Internal.remote.splitRemoteRef(ref);
  return remoteRefRes.status === "success" ? `/${remoteRefRes.filePath}` : ref;
}

/**
 * Extract a human-readable filename from a file ref (local path or remote URL).
 * Handles both remote refs (via splitRemoteRef) and plain `/public/val/...` paths.
 */
export function getFilenameFromRef(ref: string): string {
  const cleanPath = cleanRefPath(ref);
  return cleanPath.split("/").pop() || cleanPath;
}

/**
 * Parse a file ref into its constituent parts: a clean path, filename, and
 * folder (the path relative to `/public/val`).
 *
 * The `folder` strips the standard `/public/val` prefix so it shows a
 * concise location like `/images` instead of `/public/val/images`.
 */
export function getRefParts(ref: string): {
  cleanPath: string;
  filename: string;
  folder: string;
} {
  const cleanPath = cleanRefPath(ref);
  const filename = cleanPath.split("/").pop() || cleanPath;
  const folder =
    cleanPath.replace("/public/val", "").replace(/\/[^/]+$/, "") || "/";
  return { cleanPath, filename, folder };
}
