import type { ModuleFilePath, SourcePath } from "@valbuild/core";
import type { HistoryError } from "./HistoryError";
import type { RestoreVerdict } from "./types";

/**
 * Whether a selection of a commit's changes can be put back.
 *
 * Blocked by anything that would make writing the old value a lie: the current
 * schema rejecting it, a field the schema no longer has, a patch that would not
 * replay, or ops from a core version known to replay wrongly.
 *
 * Scoped by PATH, not by module. A commit that changed two fields, one of which
 * has since had its type changed, should still let the other be restored -
 * blocking the whole module would refuse work that is perfectly safe. Failures
 * that are not about a particular path (a patch that would not apply, an
 * unparseable source) block everything in the module, because there is no
 * narrower statement to make.
 */
export function buildRestoreVerdict(args: {
  moduleFilePath: ModuleFilePath;
  /** Paths this selection would write. Empty means the whole module. */
  paths: SourcePath[];
  /** Everything known to be wrong with this module, from every stage. */
  failures: HistoryError[];
}): RestoreVerdict {
  const reasons: HistoryError[] = [];
  const selected = new Set<string>(args.paths);

  for (const failure of args.failures) {
    switch (failure.kind) {
      case "schema-mismatch":
      case "unknown-field": {
        // Path-scoped. Blocks the selection if it covers that path, or any path
        // beneath it - restoring a parent writes its children too.
        if (
          args.paths.length === 0 ||
          selected.has(failure.sourcePath) ||
          args.paths.some((path) => isAtOrUnder(failure.sourcePath, path))
        ) {
          reasons.push(failure);
        }
        break;
      }
      case "source-unavailable":
      case "source-unparseable":
      case "module-removed":
      case "patch-not-applicable":
      case "unsupported-core-version":
        // Not about one path: there is no correct source to restore FROM, or
        // the ops that would produce it cannot be trusted.
        reasons.push(failure);
        break;
      case "file-unavailable":
        // The bytes cannot be read at that commit, so a restore would point at
        // a file that is not there.
        reasons.push(failure);
        break;
      case "commit-not-found":
      case "archive-unreadable":
      case "not-supported-in-fs-mode":
      case "transport":
        // Whole-commit failures never reach here - they are the err channel -
        // but if one does, refusing is the safe reading.
        reasons.push(failure);
        break;
    }
  }

  if (reasons.length === 0) {
    return { status: "restorable" };
  }
  return { status: "blocked", reasons };
}

/**
 * Is `candidate` the same path as `ancestor`, or nested inside it?
 *
 * Source paths encode as `/mod.val.ts?p="a"."b"` - each segment quoted, joined
 * by dots. Two shapes, and they need different prefixes:
 *
 *   the MODULE root has no `?p=` at all, so everything in the module is under
 *   it and the prefix is `?p=`;
 *
 *   any other path is extended by `."child"`, and because the ancestor's own
 *   closing quote is part of the prefix, `?p="title".` cannot match the sibling
 *   `?p="titleExtra"` - which is what makes string matching safe here at all.
 */
function isAtOrUnder(candidate: SourcePath, ancestor: SourcePath): boolean {
  if (candidate === ancestor) return true;
  if (!ancestor.includes("?p=")) {
    return candidate.startsWith(`${ancestor}?p=`);
  }
  return candidate.startsWith(`${ancestor}.`);
}
