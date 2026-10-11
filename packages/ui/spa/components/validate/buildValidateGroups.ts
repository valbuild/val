import {
  Internal,
  ModuleFilePath,
  ModulePath,
  SerializedSchema,
  SourcePath,
  ValidationError,
  ValidationFix,
} from "@valbuild/core";
import { isStudioFix } from "@valbuild/shared/internal";
import { prettifyFilename } from "../../utils/prettifyFilename";
import { prettifyModulePath } from "../../utils/prettifyText";
import type { FixState, ValidateGroup, ValidateRow } from "./ValidatePageView";

/** What `/validate` answered for one module. */
export type ModuleCheckResult =
  | { status: "ok"; errors: Record<SourcePath, ValidationError[]> }
  | { status: "invalid-source"; message: string };

/** What a row is about, so a press on it can be acted on. */
export type RowTarget =
  | { kind: "own"; sourcePath: SourcePath }
  /** The module as a whole: its content could not be read at all. */
  | { kind: "module"; moduleFilePath: ModuleFilePath }
  | {
      kind: "full";
      moduleFilePath: ModuleFilePath;
      sourcePath: SourcePath;
      /** Set when the Studio can fix it: see `STUDIO_FIXES`. */
      fix?: ValidationFix;
    };

export type ValidateGroupsInput = {
  /** The Studio's own errors this page lists, in order. A snapshot. */
  ownPaths: readonly SourcePath[];
  /** The Studio's own errors now: a row whose errors are gone reads "Fixed.". */
  ownErrors: Record<SourcePath, ValidationError[] | undefined>;
  /** What "Check everything" found, per module. */
  results: ReadonlyMap<ModuleFilePath, ModuleCheckResult>;
  fixes: Readonly<Record<string, FixState>>;
  /** For labels only: a page of a router is named by its route. */
  schemas: Record<ModuleFilePath, SerializedSchema> | undefined;
};

export type ValidateGroups = {
  groups: ValidateGroup[];
  targets: Map<string, RowTarget>;
};

/**
 * The Validate page's rows: the Studio's own errors first, then what the full
 * check found that the Studio did not already show, grouped by module.
 *
 * Pure, so the page and the top bar's count are the same answer: the count is
 * the number of rows here that still need something.
 */
export function buildValidateGroups(
  input: ValidateGroupsInput,
): ValidateGroups {
  const byModule = new Map<ModuleFilePath, ValidateRow[]>();
  const targets = new Map<string, RowTarget>();
  const rowsOf = (moduleFilePath: ModuleFilePath) => {
    let rows = byModule.get(moduleFilePath);
    if (!rows) {
      rows = [];
      byModule.set(moduleFilePath, rows);
    }
    return rows;
  };

  for (const sourcePath of input.ownPaths) {
    const [moduleFilePath] =
      Internal.splitModuleFilePathAndModulePath(sourcePath);
    const errors = input.ownErrors[sourcePath] ?? [];
    const id = `own:${sourcePath}`;
    targets.set(id, { kind: "own", sourcePath });
    rowsOf(moduleFilePath).push({
      id,
      location: locationOf(sourcePath, input.schemas),
      message:
        errors.length === 0
          ? "Fixed."
          : errors.map((error) => error.message).join(" · "),
      tone: "error",
      action: { kind: "open" },
      ...(errors.length === 0 ? { fixState: { status: "resolved" } } : {}),
    });
  }

  for (const [moduleFilePath, result] of input.results) {
    if (result.status === "invalid-source") {
      const id = `full:${moduleFilePath}:invalid-source`;
      targets.set(id, { kind: "module", moduleFilePath });
      rowsOf(moduleFilePath).push({
        id,
        location: titleOf(moduleFilePath),
        message: `The content of this file could not be read: ${result.message}`,
        tone: "error",
        action: { kind: "open" },
      });
      continue;
    }
    for (const row of fullCheckRows(moduleFilePath, result.errors, input)) {
      targets.set(row.row.id, row.target);
      rowsOf(moduleFilePath).push(row.row);
    }
  }

  const groups: ValidateGroup[] = [...byModule.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([moduleFilePath, rows]) => ({
      id: moduleFilePath,
      title: titleOf(moduleFilePath),
      rows: rows.map((row) => {
        const fixState = input.fixes[row.id];
        return fixState ? { ...row, fixState } : row;
      }),
    }));
  return { groups, targets };
}

/** Rows that still need something: what the top bar counts. */
export function openRowCount(groups: readonly ValidateGroup[]): number {
  return groups
    .flatMap((group) => group.rows)
    .filter(
      (row) =>
        row.fixState?.status !== "fixed" && row.fixState?.status !== "resolved",
    ).length;
}

function fullCheckRows(
  moduleFilePath: ModuleFilePath,
  errors: Record<SourcePath, ValidationError[]>,
  input: ValidateGroupsInput,
): { row: ValidateRow; target: RowTarget }[] {
  const rows: { row: ValidateRow; target: RowTarget }[] = [];
  // A wrong width and a wrong height are two errors about one image, and one
  // fix rewrites both. Shown as two rows, fixing one would leave the other
  // pointing at an error that is no longer there.
  const mismatches = new Map<SourcePath, string[]>();

  for (const [sourcePathS, found] of Object.entries(errors)) {
    const sourcePath = sourcePathS as SourcePath;
    found.forEach((error, index) => {
      if (alreadyShown(sourcePath, error, input)) {
        return;
      }
      const studioFix = error.fixes?.find(isStudioFix);
      const mismatch = metadataMismatchOf(sourcePath, error);
      if (mismatch) {
        const lines = mismatches.get(mismatch.mediaPath) ?? [];
        lines.push(mismatch.line);
        mismatches.set(mismatch.mediaPath, lines);
        return;
      }
      const id = `full:${sourcePath}:${index}`;
      rows.push({
        target: {
          kind: "full",
          moduleFilePath,
          sourcePath,
          ...(studioFix ? { fix: studioFix } : {}),
        },
        row: {
          id,
          location: locationOf(sourcePath, input.schemas),
          message: error.message,
          tone: studioFix ? "fixable" : "error",
          action: studioFix
            ? { kind: "fix" }
            : error.fixes && error.fixes.length > 0
              ? { kind: "command", command: "val validate --fix" }
              : { kind: "open" },
        },
      });
    });
  }

  for (const [mediaPath, lines] of mismatches) {
    const id = `full:${mediaPath}:metadata`;
    rows.push({
      target: {
        kind: "full",
        moduleFilePath,
        sourcePath: mediaPath,
        // The server picks image or file from the schema: see `fixForStudio`.
        fix: "image:check-metadata",
      },
      row: {
        id,
        location: locationOf(mediaPath, input.schemas),
        message: `Does not match the file: ${lines.join(", ")}.`,
        tone: "fixable",
        action: { kind: "fix" },
      },
    });
  }
  return rows;
}

/** The Studio's own check already lists this error: show it once. */
function alreadyShown(
  sourcePath: SourcePath,
  error: ValidationError,
  input: ValidateGroupsInput,
): boolean {
  return (
    input.ownErrors[sourcePath]?.some((own) => own.message === error.message) ??
    false
  );
}

/**
 * A field of a media value whose recorded metadata does not match its bytes,
 * as `validateFiles` reports it: at `…"hero"."width"`, with the two values.
 */
function metadataMismatchOf(
  sourcePath: SourcePath,
  error: ValidationError,
): { mediaPath: SourcePath; line: string } | undefined {
  if (!error.fixes?.includes("image:check-metadata")) {
    return undefined;
  }
  const value = error.value;
  if (
    typeof value !== "object" ||
    value === null ||
    !("actual" in value) ||
    !("expected" in value)
  ) {
    return undefined;
  }
  const [, modulePath] = Internal.splitModuleFilePathAndModulePath(sourcePath);
  const segments = modulePath
    ? Internal.splitModulePath(modulePath as ModulePath)
    : [];
  const field = segments[segments.length - 1];
  if (!field) {
    return undefined;
  }
  return {
    mediaPath: Internal.parentOfSourcePath(sourcePath),
    line: `${field} ${String(value.actual)} → ${String(value.expected)}`,
  };
}

/**
 * Where an error is, as the errors page always said it: a page of a router by
 * its route, anything else by its path in the module. A location, never a
 * preview (CLAUDE.md, "A preview is a TITLE, never a LOCATION").
 */
function locationOf(
  sourcePath: SourcePath,
  schemas: Record<ModuleFilePath, SerializedSchema> | undefined,
): string {
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(sourcePath);
  if (!modulePath) {
    return titleOf(moduleFilePath);
  }
  const segments = Internal.splitModulePath(modulePath as ModulePath);
  const moduleSchema = schemas?.[moduleFilePath];
  const isRouterPageKey =
    moduleSchema?.type === "record" &&
    Boolean(moduleSchema.router) &&
    segments.length === 1;
  return isRouterPageKey ? segments[0] : prettifyModulePath(modulePath);
}

/** A module as the page names it: `Content / Blog`. */
export function titleOf(moduleFilePath: ModuleFilePath): string {
  return Internal.splitModuleFilePath(moduleFilePath)
    .map(prettifyFilename)
    .join(" / ");
}
