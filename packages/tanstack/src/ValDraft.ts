import type { ValDraft } from "@valbuild/react/internal";

/**
 * What a draft page shows, read by the server for the request that renders
 * it: see `ValDraft` in `@valbuild/react` (its `read`), where it moved when
 * `@valbuild/next`'s `ValProvider` took a `draft` too. Exported from here as
 * it always was.
 */
export type { ValDraft };

/**
 * Whether the page rendered from `draft` is the live site as a visitor gets
 * it -- what content analytics counts, and nothing else. No draft at all is,
 * and so is one that is only a content version's snapshot. A draft mode
 * render is an editor's, and a proposal's address is not the live site.
 */
export function isLiveSitePage(draft: ValDraft | null | undefined): boolean {
  if (draft === null || draft === undefined) return true;
  return draft.draftMode === false && draft.atProposal !== true;
}
