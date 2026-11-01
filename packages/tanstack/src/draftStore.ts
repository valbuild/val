import type { Json, ModuleFilePath } from "@valbuild/core";
import { ValExternalStore } from "./ValOverlayContext";
import type { ValDraft } from "./ValDraft";

/**
 * The page's draft store and what the overlay's events do to it: what
 * `ValTanStackProvider` runs, as plain functions, so the scenario harness
 * (`scenarios/`) builds and feeds a page's store with the same code.
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
 */
export function createDraftStore(draft: ValDraft | null): ValExternalStore {
  const store = new ValExternalStore();
  if (isDraft(draft)) {
    for (const [path, source] of Object.entries(draft.sources)) {
      store.update(path as ModuleFilePath, source);
    }
  }
  return store;
}

/** What one `val-event` from the overlay did to the page's store. */
export type ValEventOutcome =
  | { type: "synced" }
  /** `changed`: the store holds something new, which arms a refresh. */
  | { type: "updated"; changed: boolean }
  | { type: "invalid"; detail: unknown };

/**
 * Apply one overlay event (`detail` of a `val-event`) to the page's store.
 * `sources-synced` says the editor has sent everything it holds; a
 * `source-update` replaces one module's source.
 */
export function applyValEvent(
  store: ValExternalStore,
  detail: unknown,
): ValEventOutcome {
  if (typeof detail !== "object" || detail === null || !("type" in detail)) {
    return { type: "invalid", detail };
  }
  if (detail.type === "sources-synced") {
    return { type: "synced" };
  }
  if (detail.type === "source-update") {
    const moduleFilePath =
      "moduleFilePath" in detail ? detail.moduleFilePath : undefined;
    const source = "source" in detail ? detail.source : undefined;
    if (typeof moduleFilePath === "string" && isJson(source)) {
      return {
        type: "updated",
        changed: store.update(moduleFilePath as ModuleFilePath, source),
      };
    }
  }
  return { type: "invalid", detail };
}

function isJson(value: unknown): value is Json {
  return value !== undefined;
}
