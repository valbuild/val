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

export function isValModuleUri(uri: string): boolean {
  return VAL_MODULE_RE.test(uri);
}

/** `file:///a/b.val.ts` -> `/a/b.val.ts` */
export function uriToPath(uri: string): string {
  if (!uri.startsWith("file://")) {
    return uri;
  }
  return decodeURIComponent(uri.slice("file://".length));
}

/** `/a/b.val.ts` -> `file:///a/b.val.ts` */
export function pathToUri(fsPath: string): string {
  const normalized = fsPath.split(path.sep).join("/");
  return `file://${normalized
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
