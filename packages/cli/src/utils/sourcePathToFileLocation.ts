import path from "path";
import nodeFs from "fs";
import ts from "typescript";
import picocolors from "picocolors";
import { Internal, type SourcePath } from "@valbuild/core";
import {
  createModulePathMap,
  getModulePathRange,
  type ModulePathMap,
} from "@valbuild/server";

type CachedFile = { lines: string[]; map: ModulePathMap | undefined };

/**
 * Per-run cache mapping a moduleFilePath to its parsed source. `null` means the
 * file could not be read. Each val file is read and parsed at most once.
 */
export type SourceFileCache = Map<string, CachedFile | null>;

type Position = { line: number; character: number };
type Range = { start: Position; end: Position };

/**
 * Resolves a validation `sourcePath` (e.g.
 * `/content/page.val.ts?p="image"."metadata"`) to a clickable
 * `relativePath:line:col` location pointing at the offending source literal in
 * the val file.
 *
 * Falls back to the raw `sourcePath` when the file cannot be read or no range
 * can be resolved.
 */
export function sourcePathToFileLocation(
  sourcePath: string,
  projectRoot: string,
  cache: SourceFileCache,
  target: "key" | "value" = "value",
): string {
  const resolved = resolveRange(sourcePath, projectRoot, cache, target);
  if (!resolved) {
    return sourcePath;
  }
  // TS line/character are 0-indexed; editors/terminals expect 1-indexed.
  const { relativeFile, range } = resolved;
  return `${relativeFile}:${range.start.line + 1}:${range.start.character + 1}`;
}

/**
 * Resolves a validation `sourcePath` to its individual location parts: the
 * relative file path and the 1-indexed line/column of the offending literal.
 * Returns `undefined` when the location cannot be resolved (the caller should
 * then fall back to the raw `sourcePath`).
 */
export function sourcePathToLocationParts(
  sourcePath: string,
  projectRoot: string,
  cache: SourceFileCache,
  target: "key" | "value" = "value",
): { relativeFile: string; line: number; character: number } | undefined {
  const resolved = resolveRange(sourcePath, projectRoot, cache, target);
  if (!resolved) {
    return undefined;
  }
  // TS line/character are 0-indexed; editors/terminals expect 1-indexed.
  const { relativeFile, range } = resolved;
  return {
    relativeFile,
    line: range.start.line + 1,
    character: range.start.character + 1,
  };
}

/**
 * Renders a Rust-style code frame for the offending `sourcePath`: the line
 * above, the offending line, and the line below, with red carets underlining
 * the offending span. Returns `undefined` when the location cannot be resolved
 * (the caller should then skip the frame).
 */
export function sourcePathToCodeFrame(
  sourcePath: string,
  projectRoot: string,
  cache: SourceFileCache,
  target: "key" | "value" = "value",
): string | undefined {
  const resolved = resolveRange(sourcePath, projectRoot, cache, target);
  if (!resolved) {
    return undefined;
  }
  const { lines, range } = resolved;
  const startLine = range.start.line;
  const firstLine = Math.max(0, startLine - 1);
  const lastLine = Math.min(lines.length - 1, startLine + 1);
  const gutterWidth = String(lastLine + 1).length;

  const out: string[] = [];
  for (let i = firstLine; i <= lastLine; i++) {
    const lineText = lines[i] ?? "";
    const gutter = picocolors.dim(
      `${String(i + 1).padStart(gutterWidth, " ")} | `,
    );
    out.push(`${gutter}${lineText}`);
    if (i === startLine) {
      const caretStart = range.start.character;
      const sameLine = range.end.line === range.start.line;
      const caretEnd = sameLine ? range.end.character : lineText.length;
      const caretCount = Math.max(1, caretEnd - caretStart);
      const emptyGutter = picocolors.dim(`${" ".repeat(gutterWidth)} | `);
      out.push(
        `${emptyGutter}${" ".repeat(caretStart)}${picocolors.red(
          "^".repeat(caretCount),
        )}`,
      );
    }
  }
  return out.join("\n");
}

function resolveRange(
  sourcePath: string,
  projectRoot: string,
  cache: SourceFileCache,
  target: "key" | "value",
): { relativeFile: string; lines: string[]; range: Range } | undefined {
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(sourcePath as SourcePath);

  const cached = getCachedFile(moduleFilePath, projectRoot, cache);
  if (!cached || !cached.map) {
    return undefined;
  }

  const range = getModulePathRange(modulePath, cached.map, target);
  if (!range) {
    return undefined;
  }

  return {
    relativeFile: moduleFilePath.replace(/^\//, ""),
    lines: cached.lines,
    range,
  };
}

function getCachedFile(
  moduleFilePath: string,
  projectRoot: string,
  cache: SourceFileCache,
): CachedFile | null {
  const existing = cache.get(moduleFilePath);
  if (existing !== undefined) {
    return existing;
  }
  const filePath = path.join(projectRoot, moduleFilePath);
  let fileContent: string;
  try {
    fileContent = nodeFs.readFileSync(filePath, "utf-8");
  } catch {
    cache.set(moduleFilePath, null);
    return null;
  }
  const sourceFile = ts.createSourceFile(
    filePath,
    fileContent,
    ts.ScriptTarget.ES2015,
  );
  const entry: CachedFile = {
    lines: fileContent.split(/\r?\n/),
    map: createModulePathMap(sourceFile),
  };
  cache.set(moduleFilePath, entry);
  return entry;
}
