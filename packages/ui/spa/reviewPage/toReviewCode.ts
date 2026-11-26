import { changedFiles } from "../proposals/changedFiles";
import { lineDiff } from "../proposals/lineDiff";
import type { ReviewCode } from "./types";

/**
 * A proposal's code changes, as Review lists them: every file staged as code
 * that differs from the site's copy, with its diff.
 *
 * Only what was STAGED. A content save rewrites a `.val.ts` whole, so that
 * file differs from the site's too, but what it changed is content, and
 * Review shows content as content. Listing the file again under Code would be
 * the same change twice, the second time as a diff of a file an editor never
 * opens.
 *
 * Undefined when no code changed: Review has no Code entry then.
 *
 * One group, with no chat named. Which chat staged a file is not recorded
 * anywhere yet, and a guess here would be read as a fact.
 */
export function toReviewCode(
  site: Record<string, string>,
  proposal: Record<string, string | null>,
  staged: readonly string[],
): ReviewCode | undefined {
  const files = changedFiles(site, proposal, staged)
    .filter((file) => file.staged)
    .map((file) => {
      const lines = lineDiff(
        site[file.path] ?? null,
        proposal[file.path] ?? null,
      );
      return {
        path: file.path,
        change: file.change,
        added: lines.filter((line) => line.kind === "added").length,
        removed: lines.filter((line) => line.kind === "removed").length,
        lines,
      };
    });
  if (files.length === 0) return undefined;
  return { groups: [{ session: null, files }] };
}
