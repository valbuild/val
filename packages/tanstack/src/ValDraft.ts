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
   * `false` when no draft was read -- draft mode is off -- and this carries
   * only the {@link snapshot}. Absent: a draft, as it always was.
   */
  draftMode?: false;
};
