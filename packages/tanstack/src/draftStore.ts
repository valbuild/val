import type { ModuleFilePath } from "@valbuild/core";
import { ValExternalStore } from "@valbuild/react/stega";
import type { ValDraft } from "./ValDraft";

/**
 * The page's draft store: what `ValTanStackProvider` starts from, as plain
 * functions, so the scenario harness (`scenarios/`) builds a page's store
 * with the same code. What the overlay's events do to it is
 * `applyValEvent`, in `@valbuild/react` with the store, for both frameworks.
 */

/**
 * Whether a server-read draft is a draft. At a proposal's address the server
 * sends its snapshot whether or not draft mode is on, and one that is ONLY a
 * snapshot (`draftMode: false`) is not a draft: it must not turn draft mode on
 * or say the draft is synced.
 */
export function isDraft(draft: ValDraft | null): draft is ValDraft {
  return draft !== null && draft.draftMode !== false;
}

/**
 * The store a page starts from: seeded with the server-read draft, so the
 * server render and the browser's first render show the same thing.
 *
 * The seed (`seeded`, in a read's `from`) is held in the overlay's store
 * rather than read as a source of its own, because what the Studio relays later is compared with what the
 * page shows (`ValExternalStore.receive`): the first relay of a module the
 * server already rendered moves nothing, and arms no refresh.
 */
export function createDraftStore(draft: ValDraft | null): ValExternalStore {
  const store = new ValExternalStore();
  if (isDraft(draft)) {
    for (const [path, source] of Object.entries(draft.sources)) {
      store.receive(path as ModuleFilePath, {
        status: "ready",
        source,
        from: "seeded",
        version: null,
      });
    }
  }
  return store;
}
