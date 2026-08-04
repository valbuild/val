import ts from "typescript";
import {
  Internal,
  type ModuleFilePath,
  type ValidationFix,
} from "@valbuild/core";
import {
  Diagnostic,
  DiagnosticSeverity,
  type Range,
} from "vscode-languageserver";
import { createModulePathMap, getModulePathRange } from "./modulePathMap";
import type { ValModuleContent } from "./ValProject";

/** Marks diagnostics as ours, so a client can filter on it. */
export const VAL_DIAGNOSTIC_SOURCE = "val";

/**
 * Structured payload attached to every Val diagnostic.
 *
 * Carried in `Diagnostic.data` (LSP 3.16), which is round-tripped back to the
 * server on `textDocument/codeAction`. This replaces encoding information into
 * the diagnostic's `code` string and parsing it out again — that approach could
 * not carry anything but strings and broke whenever the format shifted.
 */
export type ValDiagnosticData = {
  /** Full source path the error was reported at. */
  sourcePath: string;
  /**
   * Fixes Val says are available. Taken from `ValidationFix` in
   * `@valbuild/core`, so it always reflects this Val version rather than a list
   * copied into the client.
   */
  fixes?: ValidationFix[];
  /** Fix-specific payload, for example the offending value or route. */
  value?: unknown;
  /** True when the error is about the schema rather than the content. */
  schemaError?: boolean;
};

/** Range covering the first line, used when a path cannot be located. */
const FALLBACK_RANGE: Range = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 0 },
};

export function createValDiagnostics({
  moduleFilePath,
  content,
  text,
}: {
  moduleFilePath: ModuleFilePath;
  content: ValModuleContent;
  /** Current text of the module, as the editor sees it. */
  text: string;
}): Diagnostic[] {
  if (content.errors === false) {
    return [];
  }

  const diagnostics: Diagnostic[] = [];

  // A fatal error means the module could not be evaluated at all, so there is no
  // reliable path information: report it on the whole file.
  for (const fatal of content.errors.fatal ?? []) {
    diagnostics.push({
      range: FALLBACK_RANGE,
      severity: DiagnosticSeverity.Error,
      source: VAL_DIAGNOSTIC_SOURCE,
      message: fatal.message,
    });
  }

  const validation = content.errors.validation;
  if (!validation) {
    return diagnostics;
  }

  // Only parse the source file if there is something to place in it.
  const modulePathMap = createModulePathMap(
    ts.createSourceFile(moduleFilePath, text, ts.ScriptTarget.ES2020),
  );

  for (const [sourcePath, errors] of Object.entries(validation)) {
    for (const error of errors) {
      const data: ValDiagnosticData = {
        sourcePath,
        ...(error.fixes ? { fixes: error.fixes } : {}),
        ...(error.value !== undefined ? { value: error.value } : {}),
        ...(error.schemaError ? { schemaError: true } : {}),
      };
      diagnostics.push({
        range: rangeOf(sourcePath, modulePathMap),
        severity: DiagnosticSeverity.Error,
        source: VAL_DIAGNOSTIC_SOURCE,
        message: error.message,
        data,
      });
    }
  }

  return diagnostics;
}

function rangeOf(
  sourcePath: string,
  modulePathMap: ReturnType<typeof createModulePathMap>,
): Range {
  if (!modulePathMap) {
    return FALLBACK_RANGE;
  }
  let modulePath: string;
  try {
    [, modulePath] = Internal.splitModuleFilePathAndModulePath(
      sourcePath as never,
    );
  } catch {
    // A path we cannot split is still worth reporting, just on the whole file.
    return FALLBACK_RANGE;
  }
  // Module-level errors have an empty module path.
  if (!modulePath) {
    return FALLBACK_RANGE;
  }
  const range = getModulePathRange(modulePath, modulePathMap);
  return range ? { start: range.start, end: range.end } : FALLBACK_RANGE;
}
