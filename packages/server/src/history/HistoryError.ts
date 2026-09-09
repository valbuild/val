import type { ModuleFilePath } from "@valbuild/core";

/**
 * Everything that can go wrong reading, replaying or restoring history.
 *
 * There is a lot of it, which is the point of making it one closed union rather
 * than strings: reading a commit means reaching a content host, finding the
 * commit, reading what was recorded for each of its modules, and asking whether
 * this version of Val can make sense of the schema it was stored under. Each of
 * those fails differently, and a caller deciding what to SHOW needs to know
 * which.
 *
 * Every member has a producer. The union once carried five more - a module
 * removed from the project, an op that would not replay, a value that no longer
 * fits today's schema, a field the schema no longer defines, and ops from a
 * core version known to replay wrongly. All five belonged to reconstructing a
 * commit by replaying patches against a parsed source; storing the data ended
 * that, and a member nothing can produce is a state the Studio writes handling
 * for and never sees.
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
   * Nothing was stored for this module at this commit - a commit made before
   * history was recorded, or by a Val too old to send it. NOT the same as an
   * empty module, which is why it is reported rather than defaulted.
   */
  | { kind: "source-unavailable"; moduleFilePath: ModuleFilePath }
  /**
   * The schema stored with this commit is not one this version of Val can read.
   *
   * Expected, and NOT anyone's mistake: schemas are stored as written, and Val's
   * schema format is allowed to move. An older project opened in a newer Val -
   * or the reverse - can hit this, and the honest thing is to say the commit
   * cannot be shown HERE rather than to imply the data is damaged. Everything
   * else about the commit still reads.
   */
  | {
      kind: "schema-unreadable";
      moduleFilePath: ModuleFilePath;
      message: string;
    }
  /** A binary file or `*.val.json` entry could not be read at that commit. */
  | { kind: "file-unavailable"; gitPath: string; message: string }
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
    case "schema-unreadable":
      return `The schema stored for ${error.moduleFilePath} at this commit is not one this version of Val can read: ${error.message}`;
    case "file-unavailable":
      return `Could not read ${error.gitPath} at this commit: ${error.message}`;
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
