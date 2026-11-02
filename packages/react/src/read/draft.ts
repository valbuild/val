import type { Json, ModuleFilePath } from "@valbuild/core";
import { ValExternalStore } from "./overlayStore";

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
 * Plain JSON, because it travels from the server to the browser in the page's
 * loader data (or a server component's props). `fetchValDraft` in
 * `@valbuild/tanstack/server` reads it. Moved here from `@valbuild/tanstack`,
 * which still exports it, when `@valbuild/next`'s `ValProvider` took a
 * `draft` too: the page's half is the same in both.
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
 * Whether a server-read draft is a draft. At a proposal's address the server
 * sends its snapshot whether or not draft mode is on, and one that is ONLY a
 * snapshot (`draftMode: false`) is not a draft: it must not turn draft mode on
 * or say the draft is synced.
 */
export function isDraft(draft: ValDraft | null | undefined): draft is ValDraft {
  return draft !== null && draft !== undefined && draft.draftMode !== false;
}

/**
 * The store a page starts from: seeded with the server-read draft, so the
 * server render and the browser's first render show the same thing. What
 * both frameworks' providers start from, and the scenario world's page.
 *
 * The seed (`seeded`, in a read's `from`) is held in the overlay's store
 * rather than read as a source of its own, because what the Studio relays
 * later is compared with what the page shows (`ValExternalStore.receive`):
 * the first relay of a module the server already rendered moves nothing.
 */
export function createDraftStore(
  draft: ValDraft | null | undefined,
): ValExternalStore {
  const store = new ValExternalStore();
  if (isDraft(draft)) {
    for (const path of draftHolds(draft)) {
      store.receive(path, {
        status: "ready",
        source: draft.sources[path],
        from: "seeded",
        version: null,
      });
    }
  }
  return store;
}

/**
 * What the page reports to the Studio when it connects: the modules it was
 * rendered with a draft of. The Studio sends each of them in its catch-up,
 * pending or not (`sendPendingSources` in `@valbuild/ui`), so a draft that
 * stopped being the draft before the Studio was there -- discarded,
 * published -- is replaced rather than kept. Paths, not versions: the draft
 * the page was rendered with carries none (`ValDraft` has no versions; the
 * relay's reads have carried the Studio's since phase 5 of
 * `docs/plans/one-content-model.md`), so the page compares what it is sent
 * with what it holds (`ValExternalStore.receive`) and a module that did not
 * move costs nothing.
 */
export function draftHolds(
  draft: ValDraft | null | undefined,
): ModuleFilePath[] {
  if (!isDraft(draft)) return [];
  return Object.keys(draft.sources).filter(isModuleFilePathOf(draft.sources));
}

/** Narrows a key of `sources` back to the path it was written under. */
function isModuleFilePathOf(sources: ValDraft["sources"]) {
  return (key: string): key is ModuleFilePath =>
    Object.prototype.hasOwnProperty.call(sources, key);
}
