import fs from "fs";
import path from "path";
import ts from "typescript";
import {
  FILE_REF_PROP,
  Internal,
  type ModuleFilePath,
  type SourcePath,
  type ValidationError,
  type ValidationFix,
} from "@valbuild/core";
import {
  resolveSchemaSourceFixes,
  type SchemaSourceSnapshot,
} from "@valbuild/shared/internal";
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
 * Every diagnostic this server can produce.
 *
 * One naming convention, deliberately: `val/` followed by kebab-case. The
 * VS Code extension this replaces had accumulated three conventions at once
 * (`file-not-found`, `val:missing-module`, `image:add-to-gallery`), which made
 * codes impossible to match on reliably.
 *
 * These are *diagnostic* codes and are distinct from *fix* names, which come
 * from `ValidationFix` in `@valbuild/core` and keep Val's own `image:`/`file:`
 * vocabulary. A diagnostic says what is wrong; a fix says what can be done
 * about it, and travels in {@link ValDiagnosticData.fixes}.
 */
export const VAL_DIAGNOSTIC_CODES = [
  /** Content does not satisfy the schema. */
  "val/validation",
  /** The schema itself is invalid. */
  "val/schema",
  /** The module could not be evaluated at all. */
  "val/fatal",
  /** A referenced image or file is not on disk. */
  "val/file-not-found",
  /** The module is not registered in `val.modules`, so Val will not serve it. */
  "val/missing-module",
] as const;

export type ValDiagnosticCode = (typeof VAL_DIAGNOSTIC_CODES)[number];

/**
 * Structured payload attached to every Val diagnostic.
 *
 * Carried in `Diagnostic.data` (LSP 3.16), which is round-tripped back to the
 * server on `textDocument/codeAction`. This replaces encoding information into
 * the diagnostic's `code` string and parsing it out again — that approach could
 * not carry anything but strings and broke whenever the format shifted.
 */
export type ValDiagnosticData = {
  code: ValDiagnosticCode;
  /** Full source path the problem was reported at. */
  sourcePath: string;
  /**
   * Fixes Val says are available, from `ValidationFix` in `@valbuild/core` —
   * so this always reflects the installed Val rather than a list copied into a
   * client, which is how the previous list drifted to 13 of 18 fixes.
   */
  fixes?: ValidationFix[];
  /** Fix-specific payload, for example the offending value or route. */
  value?: unknown;
  /** Absolute path of the missing file, for `val/file-not-found`. */
  filePath?: string;
};

/**
 * Severity policy, in one place.
 *
 * - **Warning** — Val can fix it automatically. Mirrors the CLI, which prints
 *   these with `⚠` (its `validation-fixable-error` event) rather than `✘`. In an
 *   editor a one-click-fixable metadata mismatch should not shout as loudly as a
 *   type error.
 * - **Error** — everything else: the content is wrong, the schema is wrong, or
 *   the module does not work at all.
 *
 * Note that `val validate` still exits non-zero for fixable errors, so Warning
 * here is about presentation, not about the problem being optional.
 */
export function severityFor({
  code,
  fixes,
}: {
  code: ValDiagnosticCode;
  fixes?: ValidationFix[];
}): DiagnosticSeverity {
  if (code === "val/validation" && fixes && fixes.length > 0) {
    return DiagnosticSeverity.Warning;
  }
  return DiagnosticSeverity.Error;
}

/** Range covering the start of the file, used when a path cannot be located. */
const FALLBACK_RANGE: Range = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 0 },
};

/** Fixes that operate on a file or image reference. */
const FILE_FIXES: readonly string[] = [
  "image:add-metadata",
  "image:check-metadata",
  "image:upload-remote",
  "image:download-remote",
  "image:check-remote",
  "file:add-metadata",
  "file:check-metadata",
  "file:upload-remote",
  "file:download-remote",
  "file:check-remote",
];

function build(
  range: Range,
  message: string,
  data: ValDiagnosticData,
): Diagnostic {
  return {
    range,
    severity: severityFor(data),
    source: VAL_DIAGNOSTIC_SOURCE,
    code: data.code,
    message,
    data,
  };
}

export function createValDiagnostics({
  moduleFilePath,
  content,
  text,
  valRoot,
  snapshot,
}: {
  moduleFilePath: ModuleFilePath;
  content: ValModuleContent;
  /** Current text of the module, as the editor sees it. */
  text: string;
  /**
   * Val root, used to resolve file references. When omitted, file existence is
   * not checked.
   */
  valRoot?: string;
  /**
   * Project-wide schemas and sources.
   *
   * `keyOf` and `route` validation cannot be completed by core alone — it has to
   * look at other modules — so core emits a placeholder error carrying the fix
   * name and a developer-facing message. Given a snapshot, those are resolved
   * here: valid references drop out, invalid ones become real messages. Without
   * one they are suppressed, since showing the placeholder would put
   * unactionable noise on correct code.
   */
  snapshot?: SchemaSourceSnapshot;
}): Diagnostic[] {
  if (content.errors === false) {
    return [];
  }

  const diagnostics: Diagnostic[] = [];

  // A fatal error means the module could not be evaluated, so there is no
  // reliable path information: report it on the whole file.
  for (const fatal of content.errors.fatal ?? []) {
    diagnostics.push(
      build(FALLBACK_RANGE, fatal.message, {
        code: "val/fatal",
        sourcePath: moduleFilePath,
      }),
    );
  }

  const rawValidation = content.errors.validation;
  if (!rawValidation) {
    return diagnostics;
  }

  // Resolve the deferred keyOf/route placeholders against the rest of the
  // project. This is the same call `val validate` and the Val UI make, so all
  // three agree on which references are actually broken.
  const validation = snapshot
    ? resolveSchemaSourceFixes(rawValidation, snapshot)
    : dropDeferredPlaceholders(rawValidation);

  // Only parse the source file if there is something to place in it.
  const modulePathMap = createModulePathMap(
    ts.createSourceFile(moduleFilePath, text, ts.ScriptTarget.ES2020),
  );

  for (const [sourcePath, errors] of Object.entries(validation)) {
    for (const error of errors) {
      const fixes = error.fixes;

      // A file-related fix cannot succeed if the file is not there, and
      // "metadata is incorrect" is a misleading way to say "the file is
      // missing". Report the real problem instead, exactly as the CLI's fix
      // handlers do when their precondition fails.
      const missing =
        valRoot && fixes?.some((fix) => FILE_FIXES.includes(fix))
          ? missingFileRef({ sourcePath, content, valRoot })
          : undefined;
      if (missing) {
        diagnostics.push(
          build(
            rangeOf(sourcePath, modulePathMap, "_ref"),
            `File ${missing} does not exist`,
            { code: "val/file-not-found", sourcePath, filePath: missing },
          ),
        );
        continue;
      }

      diagnostics.push(
        build(rangeOf(sourcePath, modulePathMap), error.message, {
          code: error.schemaError ? "val/schema" : "val/validation",
          sourcePath,
          ...(fixes ? { fixes } : {}),
          ...(error.value !== undefined ? { value: error.value } : {}),
        }),
      );
    }
  }

  return diagnostics;
}

/**
 * Resolve a source path to its file reference and report the absolute path when
 * it is not on disk.
 *
 * Mirrors the precondition check in `handleFileMetadata`
 * (`packages/cli/src/runValidation.ts`): resolve the path, read `FILE_REF_PROP`,
 * check the file exists.
 */
function missingFileRef({
  sourcePath,
  content,
  valRoot,
}: {
  sourcePath: string;
  content: ValModuleContent;
  valRoot: string;
}): string | undefined {
  if (!content.source || !content.schema) {
    return undefined;
  }
  try {
    const [, modulePath] = Internal.splitModuleFilePathAndModulePath(
      sourcePath as never,
    );
    const resolved = Internal.resolvePath(
      modulePath,
      content.source,
      content.schema,
    );
    const ref = (resolved.source as Record<string, unknown> | undefined)?.[
      FILE_REF_PROP
    ];
    if (typeof ref !== "string") {
      return undefined;
    }
    // Remote references are URLs and are not expected on disk.
    if (Internal.remote.splitRemoteRef(ref).status === "success") {
      return undefined;
    }
    const filePath = path.join(valRoot, ref);
    return fs.existsSync(filePath) ? undefined : filePath;
  } catch {
    // Resolution can fail when the schema failed to serialize; skip the check
    // rather than dropping the underlying validation error.
    return undefined;
  }
}

/**
 * Diagnostic for a Val module that is not registered in `val.modules`.
 *
 * Val only serves modules listed there, so an unregistered module silently does
 * nothing — worth surfacing even though it is not a validation error.
 */
export function createMissingModuleDiagnostic({
  moduleFilePath,
}: {
  moduleFilePath: ModuleFilePath;
}): Diagnostic {
  return build(
    FALLBACK_RANGE,
    `${moduleFilePath} is not registered in val.modules, so Val will not serve it.`,
    { code: "val/missing-module", sourcePath: moduleFilePath },
  );
}

function rangeOf(
  sourcePath: string,
  modulePathMap: ReturnType<typeof createModulePathMap>,
  /** Optional child segment to prefer, for example `_ref`. */
  preferChild?: string,
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
  if (preferChild) {
    const child = getModulePathRange(
      `${modulePath}.${JSON.stringify(preferChild)}`,
      modulePathMap,
    );
    if (child) {
      return { start: child.start, end: child.end };
    }
  }
  const range = getModulePathRange(modulePath, modulePathMap);
  return range ? { start: range.start, end: range.end } : FALLBACK_RANGE;
}

/** Fixes core cannot resolve without a project-wide snapshot. */
const DEFERRED_FIXES: readonly string[] = [
  "keyof:check-keys",
  "router:check-route",
];

/**
 * Fallback for when no snapshot is available: drop the placeholders rather than
 * show their developer-facing text.
 */
function dropDeferredPlaceholders(
  validation: Record<SourcePath, ValidationError[]>,
): Record<SourcePath, ValidationError[]> {
  const out: Record<SourcePath, ValidationError[]> = {};
  for (const [sourcePath, errors] of Object.entries(validation) as [
    SourcePath,
    ValidationError[],
  ][]) {
    const kept = errors.filter(
      (error) =>
        !(
          error.fixes?.length &&
          error.fixes.every((fix) => DEFERRED_FIXES.includes(fix))
        ),
    );
    if (kept.length > 0) {
      out[sourcePath] = kept;
    }
  }
  return out;
}
