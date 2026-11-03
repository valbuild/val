import type { Json, ModuleFilePath } from "@valbuild/core";
import type { ModuleVersion } from "@valbuild/shared/internal";
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
   * The version of each module in {@link sources}, as the server's draft
   * computed it: `{ schema, base, chain }`, plain strings. The Studio relays
   * each module with the version it computed, which is the server's for the
   * same content, so the page compares two versions rather than two
   * modules' content -- on the first relay too -- and tells the Studio which
   * versions it holds when it connects. Optional: a draft read by a server
   * of the release before carries none, and is compared by content.
   */
  versions?: Record<
    ModuleFilePath,
    { schema: string; base: string; chain: string }
  >;
  /**
   * At a proposal's address: the Source the proposal has saved, which
   * replaces the bundle's for those modules on EVERY render, draft or not --
   * the third source provider (`ValProposal` in `@valbuild/server`). Sent
   * whether or not draft mode is on, because a reviewer who is not editing is
   * looking at the proposal too. A draft, when there is one, applies on top.
   */
  snapshot?: Record<ModuleFilePath, Json>;
  /**
   * @deprecated Not sent any more, and not read: the Studio's overlay reads
   * the base the server is on by version (the manifest names it), so a page
   * no longer hands it over. Kept on the type for a release, so a draft of
   * the release before still type-checks; it goes after that.
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
        version: draft.versions?.[path] ?? null,
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
 * published -- is replaced rather than kept. With the version of each
 * where the draft carries one ({@link draftHoldsVersions}): the page compares
 * what it is sent with what it holds by version (`ValExternalStore.receive`),
 * and a module that did not move costs nothing.
 */
export function draftHolds(
  draft: ValDraft | null | undefined,
): ModuleFilePath[] {
  if (!isDraft(draft)) return [];
  return Object.keys(draft.sources).filter(isModuleFilePathOf(draft.sources));
}

/**
 * The versions the page was rendered with, of the modules
 * {@link draftHolds} names, where the draft says (phase 6 of
 * `docs/plans/one-content-model.md`): what the page reports beside the paths
 * when it connects, so the Studio can tell a module the page holds at the
 * version it would send. A module without one is left out.
 */
export function draftHoldsVersions(
  draft: ValDraft | null | undefined,
): Partial<Record<ModuleFilePath, ModuleVersion>> {
  const versions: Partial<Record<ModuleFilePath, ModuleVersion>> = {};
  if (!isDraft(draft) || draft.versions === undefined) return versions;
  for (const path of draftHolds(draft)) {
    const version = draft.versions[path];
    if (version !== undefined) versions[path] = version;
  }
  return versions;
}

/** Narrows a key of `sources` back to the path it was written under. */
function isModuleFilePathOf(sources: ValDraft["sources"]) {
  return (key: string): key is ModuleFilePath =>
    Object.prototype.hasOwnProperty.call(sources, key);
}
