import type { ModuleFilePath, PatchId, SourcePath } from "@valbuild/core";
import type { ValidationError } from "@valbuild/core";

/**
 * Everything that can go wrong reading, replaying or restoring history.
 *
 * There is a lot of it, which is the point of making it one closed union rather
 * than strings: reconstructing a module as it was at some commit means reading
 * an archive written by an older version of Val, parsing source someone may
 * have hand-edited since, replaying ops against it, and then asking whether the
 * result still fits a schema that has moved on. Each of those fails
 * differently, and a caller deciding whether to OFFER A RESTORE needs to know
 * which.
 *
 * ## The rule
 *
 * Whole-commit failures are the `err` channel. Per-module and per-patch
 * failures ride along inside the `ok` payload.
 *
 * A commit that cannot be found or read at all has nothing to show. But one
 * unparseable module out of ten does not make the other nine unreadable, and
 * collapsing the whole view because of it would hide exactly the information
 * someone needs to see - that this module is the broken one.
 */
export type HistoryError =
  /** No such commit, or not one Val created. Nothing will make it readable. */
  | { kind: "commit-not-found"; commitSha: string }
  /**
   * The commit says it has an archive and the archive is missing or malformed.
   * Distinct from a commit that predates archiving, which is not an error.
   */
  | { kind: "archive-unreadable"; commitSha: string; message: string }
  /**
   * No pre-commit text was stored for this module - a commit made before
   * archiving shipped, or by a Val too old to send it. NOT the same as an empty
   * module, which is why it is reported rather than defaulted.
   */
  | { kind: "source-unavailable"; moduleFilePath: ModuleFilePath }
  /**
   * The stored `.val.ts` will not statically evaluate to a source. Usually a
   * module authored before the current shape (e.g. a `c.image(...)` call where
   * a plain object now goes), or one hand-edited into something that is no
   * longer a literal.
   */
  | {
      kind: "source-unparseable";
      moduleFilePath: ModuleFilePath;
      message: string;
    }
  /** The module has no schema in the project today: it was deleted or renamed. */
  | { kind: "module-removed"; moduleFilePath: ModuleFilePath }
  /**
   * An op would not apply to the source it was recorded against. Per patch, so
   * the other patches in the same module still replay.
   */
  | {
      kind: "patch-not-applicable";
      patchId: PatchId;
      moduleFilePath: ModuleFilePath;
      message: string;
    }
  /**
   * The historical value does not satisfy TODAY's schema. The main reason a
   * restore is refused: the shape moved on, and writing the old value back
   * would put the module in a state the schema says is invalid.
   */
  | {
      kind: "schema-mismatch";
      moduleFilePath: ModuleFilePath;
      sourcePath: SourcePath;
      errors: ValidationError[];
    }
  /**
   * The historical value has a field the current schema does not define.
   *
   * Separate from `schema-mismatch` because validation does not always object
   * to an extra key, and restoring one would silently reintroduce a field that
   * was deliberately removed.
   */
  | {
      kind: "unknown-field";
      moduleFilePath: ModuleFilePath;
      sourcePath: SourcePath;
      key: string;
    }
  /** A binary file or `*.val.json` entry could not be read at that commit. */
  | { kind: "file-unavailable"; gitPath: string; message: string }
  /**
   * These ops were written by a version of @valbuild/core known to produce ops
   * that do not replay correctly. Flagged rather than replayed, because a wrong
   * source that looks right is worse than a refusal.
   */
  | { kind: "unsupported-core-version"; patchId: PatchId; coreVersion: string }
  /** History needs the content host; local FS mode has git instead. */
  | { kind: "not-supported-in-fs-mode" }
  /** Could not reach the content host at all. */
  | { kind: "transport"; message: string };

export function historyErrorMessage(error: HistoryError): string {
  switch (error.kind) {
    case "commit-not-found":
      return `No commit ${error.commitSha} created by Val in this project`;
    case "archive-unreadable":
      return `Could not read the stored record of commit ${error.commitSha}: ${error.message}`;
    case "source-unavailable":
      return `No stored source for ${error.moduleFilePath} at this commit (it predates history being recorded)`;
    case "source-unparseable":
      return `Could not read the stored source of ${error.moduleFilePath}: ${error.message}`;
    case "module-removed":
      return `${error.moduleFilePath} no longer exists in this project`;
    case "patch-not-applicable":
      return `Patch ${error.patchId} does not apply to ${error.moduleFilePath}: ${error.message}`;
    case "schema-mismatch":
      return `${error.sourcePath} does not fit the current schema: ${error.errors
        .map((validationError) => validationError.message)
        .join("; ")}`;
    case "unknown-field":
      return `${error.sourcePath} has '${error.key}', which the current schema does not define`;
    case "file-unavailable":
      return `Could not read ${error.gitPath} at this commit: ${error.message}`;
    case "unsupported-core-version":
      return `Patch ${error.patchId} was written by @valbuild/core ${error.coreVersion}, which cannot be replayed reliably`;
    case "not-supported-in-fs-mode":
      return "History is only available for projects connected to Val's content service";
    case "transport":
      return `Could not reach the content service: ${error.message}`;
  }
}

/**
 * Whether an error is about the whole commit rather than one part of it.
 *
 * The `err`/`ok`-payload split above, as a predicate, so callers do not
 * re-derive it and disagree.
 */
export function isWholeCommitError(error: HistoryError): boolean {
  return (
    error.kind === "commit-not-found" ||
    error.kind === "archive-unreadable" ||
    error.kind === "not-supported-in-fs-mode" ||
    error.kind === "transport"
  );
}
