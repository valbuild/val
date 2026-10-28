import type { Json, ModuleFilePath } from "@valbuild/core";

/**
 * What a draft page shows, read by the server for the request that renders it.
 *
 * The source of every module the editor's draft CHANGES -- the ones with
 * patches applied, published-not-yet-built ones included -- and nothing
 * else: a module without changes is the build's own source, which the page
 * already has. Handed to `<ValProvider draft>` so the server's render and the
 * browser's first render resolve the same text, and the page never shows the
 * published version first and the draft a moment later.
 *
 * A `.jsonValues()` module is in the shape the Studio's own store gives it: the
 * entries the draft edits hold their content, and every other entry is the
 * thunkless marker the hooks resolve from the bundle.
 *
 * Plain JSON, because it travels from a server function to the browser in the
 * page's loader data. `fetchValDraft` in `@valbuild/tanstack/server` reads it.
 */
export type ValDraft = {
  sources: Record<ModuleFilePath, Json>;
  /**
   * At a proposal's address: the Source the proposal has saved, which
   * replaces the bundle's for those modules on EVERY render, draft or not --
   * the third source provider (`ValProposal` in `@valbuild/server`). Sent
   * whether or not draft mode is on, because a reviewer who is not editing is
   * looking at the proposal too. A draft, when there is one, applies on top.
   */
  snapshot?: Record<ModuleFilePath, Json>;
  /**
   * The Source the server's draft starts from where it is not the bundle's: a
   * content version -- content published without a build -- with a
   * proposal's saves over it, as stored (`.jsonValues()` markers and all).
   * The Studio's overlay starts from it, by `window.__VAL_BASE__`: after a
   * content-only publish the bundle still holds the text from before it, and
   * a draft page took that text back whenever the overlay's bundle reached
   * it first. Sent with a draft only -- the overlay runs in draft mode alone.
   */
  base?: Record<ModuleFilePath, Json>;
  /**
   * `false` when no draft was read -- draft mode is off -- and this carries
   * only the {@link snapshot}. Absent: a draft, as it always was.
   */
  draftMode?: false;
  /**
   * `true` at a proposal's address. Not the same as a {@link snapshot}: a
   * site serving a content version -- content published without a build --
   * hands the readers that as a snapshot too, and is the live site. Content
   * analytics counts the live site's visitors and nobody else's, so this is
   * what `ValProvider` asks, never whether there is a snapshot.
   */
  atProposal?: true;
};

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
