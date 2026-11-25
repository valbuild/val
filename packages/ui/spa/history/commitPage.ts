import type { HistoricalCommit, ValClient } from "@valbuild/shared/internal";

/** One page of a branch's commits, newest first, or why there is none. */
export type CommitPage =
  | {
      status: "success";
      commits: HistoricalCommit[];
      nextCursor: string | null;
    }
  | { status: "error"; httpStatus: number | null; message: string };

/**
 * Read one page of the commits on `branch` (`/history/commits`): what History
 * lists (`useCommitList`) and what the assistant's `list_branches` names as a
 * branch's last commit (`branchTools.ts`). One function, so the two cannot
 * read the history differently.
 */
export async function fetchCommitPage(
  client: ValClient,
  branch: string,
  limit: number,
  cursor: string | undefined,
): Promise<CommitPage> {
  try {
    const res = await client("/history/commits", "GET", {
      query: { branch, limit, cursor },
    });
    if (res.status === 200) {
      return {
        status: "success",
        commits: res.json.commits,
        nextCursor: res.json.nextCursor,
      };
    }
    return {
      status: "error",
      httpStatus: res.status,
      message:
        "message" in res.json
          ? res.json.message
          : "The commit history could not be read.",
    };
  } catch (err) {
    return {
      status: "error",
      httpStatus: null,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
