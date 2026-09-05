import { result } from "@valbuild/core/fp";
import type { JSONValue } from "@valbuild/core/patch";
import type { ValOps } from "../ValOps";
import type { HistoryError } from "./HistoryError";
import type { AffectedFile } from "./types";

export type JsonEntriesResult = {
  entries: Record<string, JSONValue>;
  /** Entries that could not be read. Per file, so one bad entry is not fatal. */
  failures: HistoryError[];
};

/**
 * The `*.val.json` entries a commit touched, read from git at that commit.
 *
 * Not stored in the commit record, unlike the `.val.ts` sources: an entry is a
 * plain JSON file that git has at every commit, so a second copy could only
 * drift from the first. A `.val.ts` is different - it is what a restore
 * replays patches against, and reading it from git would make every look at
 * history depend on the repository still being there.
 *
 * Reads at the commit itself rather than its parent: an entry's content AT a
 * commit is what that commit produced, which is the "after" side. The "before"
 * side is the same file at the parent commit, and a caller that wants it asks
 * for the parent.
 */
export async function resolveJsonEntriesAtCommit(
  ops: ValOps,
  commitSha: string,
  affectedFiles: AffectedFile[],
): Promise<result.Result<JsonEntriesResult, HistoryError>> {
  const entryPaths = affectedFiles
    .filter(
      (file): file is Extract<AffectedFile, { gitPath: string }> =>
        file.kind === "json-entry",
    )
    // A deleted entry has no content at this commit; asking for it would be a
    // guaranteed 404 reported as a failure, which is noise rather than news.
    .filter((file) => file.change !== "deleted")
    .map((file) => file.gitPath);

  if (entryPaths.length === 0) {
    return result.ok({ entries: {}, failures: [] });
  }

  const entries: Record<string, JSONValue> = {};
  const failures: HistoryError[] = [];
  const fetched = await Promise.all(
    entryPaths.map(async (gitPath) => ({
      gitPath,
      res: await ops.getFileAtCommit(commitSha, gitPath, false),
    })),
  );
  for (const { gitPath, res } of fetched) {
    if (result.isErr(res)) {
      failures.push({
        kind: "file-unavailable",
        gitPath,
        message:
          res.error.kind === "file-unavailable"
            ? res.error.message
            : `could not read entry: ${res.error.kind}`,
      });
      continue;
    }
    try {
      entries[gitPath] = JSON.parse(res.value.toString("utf-8"));
    } catch (err) {
      failures.push({
        kind: "file-unavailable",
        gitPath,
        message: `not valid JSON at this commit: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    }
  }
  return result.ok({ entries, failures });
}
