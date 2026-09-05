import { result } from "@valbuild/core/fp";
import type { ValOps } from "../ValOps";
import type { HistoryError } from "./HistoryError";
import type { CommitPage } from "./types";

/**
 * One page of a branch's commits, newest first.
 *
 * Cursor-based rather than offset-based: pages are read while people keep
 * publishing, and an offset would silently skip or repeat a commit whenever one
 * arrives mid-listing. Pass the previous page's `nextCursor`; `null` means
 * there are no more.
 */
export async function listCommits(
  ops: ValOps,
  branch: string,
  options?: { limit?: number; cursor?: string },
): Promise<result.Result<CommitPage, HistoryError>> {
  return ops.listCommits(branch, options);
}
