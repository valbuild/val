import path from "path";
import type { ModuleFilePath } from "@valbuild/core";

/**
 * Conversions between LSP document URIs and the paths Val uses.
 *
 * Deliberately minimal rather than pulling in `vscode-uri`: the server only ever
 * deals with local `file:` URIs, and keeping this small makes the assumptions
 * visible.
 */

/** Matches the Val module files the server validates. */
const VAL_MODULE_RE = /\.val\.(ts|js|tsx|jsx)$/;

/** `file:` with an optional authority, capturing authority and path apart. */
const FILE_URI_RE = /^file:\/\/([^/?#]*)([^?#]*)/i;

/** A `/c:/...` prefix, i.e. a Windows drive letter as it appears in a URI. */
const URI_DRIVE_LETTER_RE = /^\/([a-zA-Z]:)(\/|$)/;

/**
 * Matches the `*.val.json` files that hold `.jsonValues()` entry content. Not a
 * Val module: nothing validates one on its own, but editing it changes what a
 * module validates to, so the server has to notice.
 */
const VAL_JSON_ENTRY_RE = /\.val\.json$/;

export function isValModuleUri(uri: string): boolean {
  return VAL_MODULE_RE.test(uri);
}

export function isValJsonEntryUri(uri: string): boolean {
  return VAL_JSON_ENTRY_RE.test(uri);
}

/**
 * `decodeURIComponent` throws on malformed escapes (`%zz`). A client that sends
 * one is broken, but that should not take the server down: fall back to the
 * undecoded text so the path is at worst not found.
 */
function decodeSafely(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * `file:///a/b.val.ts` -> `/a/b.val.ts`
 *
 * Percent escapes are decoded, Windows drive letters lose the leading slash
 * (`file:///c%3A/a` -> `c:/a`), and a URI with an authority is read as a UNC
 * path (`file://host/share/a` -> `//host/share/a`). Anything that is not a
 * `file:` URI is passed through unchanged, since callers also hand us plain
 * paths.
 */
export function uriToPath(uri: string): string {
  const match = FILE_URI_RE.exec(uri);
  if (!match) {
    return uri;
  }
  const authority = decodeSafely(match[1]);
  const fsPath = decodeSafely(match[2] || "/");
  if (authority) {
    return `//${authority}${fsPath}`;
  }
  return fsPath.replace(URI_DRIVE_LETTER_RE, "$1$2");
}

/**
 * `/a/b.val.ts` -> `file:///a/b.val.ts`
 *
 * The escaping matches what VS Code produces (drive-letter colons included), so
 * that a URI built here can be looked up in the open-document map keyed by the
 * URIs the client sent.
 */
export function pathToUri(fsPath: string): string {
  const normalized = fsPath.split(path.sep).join("/");
  const rooted = normalized.startsWith("/") ? normalized : `/${normalized}`;
  return `file://${rooted
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
}

/**
 * Convert a document URI into the `ModuleFilePath` Val addresses it by: a
 * POSIX-style path relative to the Val root, with a leading slash.
 *
 * Returns `undefined` when the file lies outside the Val root — one server
 * serves exactly one root, so another root's files are not its business.
 */
export function toModuleFilePath(
  valRoot: string,
  uri: string,
): ModuleFilePath | undefined {
  const fsPath = uriToPath(uri);
  const relative = path.relative(valRoot, fsPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return undefined;
  }
  return `/${relative.split(path.sep).join("/")}` as ModuleFilePath;
}
