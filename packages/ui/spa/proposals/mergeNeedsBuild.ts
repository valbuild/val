import type { ProposalJson } from "./proposalsClient";

/**
 * Whether Publish in this proposal needs a build: the guess a page that cannot
 * build (an iPhone, Safari) makes at the tap, because only a tap may open the
 * builder tab. valbuild/home `docs/hosted-publishing.md`, step 8.
 *
 * - **Content only** (nothing staged): no. The merge is a ref update, and its
 *   content goes live on the build the site already serves.
 * - **Code, built from what is staged now**: no. The merge goes live on the
 *   proposal's own build.
 * - **Code, not built yet**: yes.
 * - **Not known** (a read that says nothing of staged files): yes, as before.
 *
 * A guess, as the site's own Publish makes one (`pendingNeedsBuild`): a merge
 * that needs a build after all asks for the tab with one more tap.
 */
export function mergeNeedsBuild(
  proposal: Pick<ProposalJson, "staged"> | null,
): boolean {
  const staged = proposal?.staged;
  if (staged === undefined) return true;
  return staged.files.length > 0 && staged.buildRequired;
}
