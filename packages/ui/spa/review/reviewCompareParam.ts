import type { SourcePath } from "@valbuild/core";
import { isPathWithin } from "../utils/sourcePath";
import type { SerializedPatchSet } from "../utils/PatchSets";
import { reviewSourcePath } from "./toReviewModel";

/**
 * The review page's compare dialog, as it lives in the URL.
 *
 * `/val/review?compare` opens the dialog on its first change, and
 * `/val/review?compare=<source path>` opens it on the change at that path. A
 * link, for the reason the review page is a route at all: "look at this change
 * before we ship it" is a thing you send somebody, and a dialog you can only
 * reach by pressing a button is a step you have to describe in words.
 *
 * It is also how the rest of the Studio says "show me the diff for this": the
 * media gallery's Compare link names the file's entry, and lands on it.
 */
export const REVIEW_COMPARE_PARAM = "compare";

/**
 * Null is a closed dialog. An open one with no `sourcePath` opens on the first
 * change, exactly as pressing the review page's Compare button does.
 */
export type ReviewCompareParam = { sourcePath: SourcePath | null } | null;

/** Read the dialog's state out of a URL. Total, like `parseHistoryParams`. */
export function parseReviewCompareParam(
  search: string | URLSearchParams,
): ReviewCompareParam {
  const params =
    typeof search === "string" ? new URLSearchParams(search) : search;
  if (!params.has(REVIEW_COMPARE_PARAM)) return null;
  const value = params.get(REVIEW_COMPARE_PARAM);
  return { sourcePath: value ? (value as SourcePath) : null };
}

/** Write the dialog's state into a URL's params, in place. Writes AND clears. */
export function applyReviewCompareParam(
  params: URLSearchParams,
  state: ReviewCompareParam,
): URLSearchParams {
  params.delete(REVIEW_COMPARE_PARAM);
  if (state !== null) {
    params.set(REVIEW_COMPARE_PARAM, state.sourcePath ?? "");
  }
  return params;
}

/**
 * `params.toString()`, except that an open dialog with no target is written
 * `?compare` rather than `?compare=`.
 *
 * The two parse the same. This is only so the URL in the address bar reads the
 * way someone would type it.
 */
export function searchStringOf(params: URLSearchParams): string {
  return params
    .toString()
    .replace(
      new RegExp(`(^|&)${REVIEW_COMPARE_PARAM}=(?=&|$)`),
      `$1${REVIEW_COMPARE_PARAM}`,
    );
}

/**
 * Whether the dialog has anything to open onto.
 *
 * The dialog compares the STAGED set — see `ReviewSurface` — so a link to a
 * change that is unstaged, or that has shipped since the link was made, has
 * no pane to land on. Opening it anyway would show some other change under a
 * link that named this one, which is worse than not opening: the review page
 * behind it still lists the change, under Unstaged, where it actually is.
 *
 * Matched in both directions. The link names what the linking surface knows
 * — the gallery knows the ENTRY — while the change can sit inside it (an
 * edited `alt`) or around it (the module root, in a set that rewrote the
 * whole gallery).
 */
export function canOpenReviewCompare(
  stagedPatchSets: SerializedPatchSet,
  sourcePath: SourcePath | null,
): boolean {
  if (stagedPatchSets.length === 0) return false;
  if (sourcePath === null) return true;
  return stagedPatchSets.some((patchSet) => {
    const changed = reviewSourcePath(patchSet);
    return (
      isPathWithin(changed, sourcePath) || isPathWithin(sourcePath, changed)
    );
  });
}
