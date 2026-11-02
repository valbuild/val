import { Internal, type Json, type ModuleFilePath } from "@valbuild/core";
import type {
  ContentSource,
  EntryRead,
  ModuleRead,
} from "@valbuild/shared/internal";
import { bundledJsonEntryImport } from "./jsonValues";
import type { ValExternalStore } from "./overlayStore";

/*
 * The sources a page reads from, in the browser and on the server alike
 * (the server's own draft, `serverDraftSource`, is in `@valbuild/server`).
 * See `docs/plans/one-content-model.md`, "One way to load".
 */

const PASS: ModuleRead & EntryRead = { status: "pass" };

/**
 * What a module's source says about one of its `.jsonValues()` entries: the
 * same rule for every source that holds a whole module (the overlay, a
 * snapshot). A module that is `null` (a nullable record) has no entries; a
 * key it does not have is GONE -- an answer, not "ask the next one"; an entry
 * that is still a marker is one this source has not loaded, so it passes.
 */
export function entryOfModuleSource(
  source: Json,
  key: string,
  from: string,
): EntryRead {
  if (source === null) {
    return { status: "gone", from };
  }
  if (typeof source !== "object" || Array.isArray(source)) {
    return PASS;
  }
  // Own keys only: an entry may be named `toString`.
  if (!Object.prototype.hasOwnProperty.call(source, key)) {
    return { status: "gone", from };
  }
  const entry: unknown = Object.entries(source).find(([k]) => k === key)?.[1];
  if (Internal.isJson(entry)) {
    return PASS;
  }
  return { status: "ready", content: entry, from };
}

/**
 * A content version's or a proposal's saved Source, for the modules it has
 * (`ValDraft.snapshot`, `snapshotForReaders`): it stands in for the bundle's,
 * draft mode or not. Its entries are content where the proposal saved them.
 */
export function snapshotSource(
  snapshot: Readonly<Record<ModuleFilePath, Json>> | undefined,
): ContentSource {
  const sourceOf = (path: ModuleFilePath): Json | undefined =>
    snapshot !== undefined &&
    Object.prototype.hasOwnProperty.call(snapshot, path)
      ? snapshot[path]
      : undefined;
  return {
    name: "snapshot",
    module(path) {
      const source = sourceOf(path);
      return source === undefined
        ? PASS
        : { status: "ready", source, from: "snapshot", version: null };
    },
    entry(path, key) {
      const source = sourceOf(path);
      return source === undefined
        ? PASS
        : entryOfModuleSource(source, key, "snapshot");
    },
  };
}

/** What the page knows about draft mode and the Studio, for {@link overlaySource}. */
export type OverlayState = {
  /** `null` until `/draft/stat` has answered. */
  draftMode: boolean | null;
  /**
   * Whether a read may wait (`ValProvider`'s `suspend`, once the provider has
   * switched it on). Without it every wait is a `pass`: the next source
   * answers, which is what a page shows until the draft arrives.
   */
  suspend: boolean;
  /** Resolves when `draftMode` stops being unknown. */
  draftModeReady?: Promise<void>;
  /** The Studio has said it sent everything it holds (`sources-synced`). */
  synced: boolean;
};

/**
 * What the Studio sent the page (`ValExternalStore`, fed by the relay), with
 * the three waits `suspend` is made of (`architecture/quirks.md`, "`suspend`
 * is three waits") as its states:
 *
 * 1. Draft mode unknown: wait for it to be known (`draftModeReady`), because
 *    a read that slips through then is a read of published content, and for
 *    a route that only exists in a patch that is a `notFound()` nothing later
 *    undoes.
 * 2. Draft mode on, and the Studio has not yet said it sent everything: a
 *    module it has not sent may still be coming, so wait for it. After
 *    `sources-synced` a module it did not send has no draft: pass.
 * 3. The render that decides is the provider's, which turns `suspend` on
 *    after hydrating; until then every wait is a pass.
 *
 * Draft mode off, or no store (a visitor): pass, always.
 */
export function overlaySource(
  store: ValExternalStore | undefined,
  state: OverlayState,
): ContentSource {
  const gate = (path: ModuleFilePath): ModuleRead => {
    if (store === undefined || state.draftMode === false) {
      return PASS;
    }
    if (
      state.suspend &&
      state.draftMode === null &&
      state.draftModeReady !== undefined
    ) {
      return { status: "pending", ready: state.draftModeReady };
    }
    const held = state.draftMode === true ? store.read(path) : undefined;
    if (held !== undefined) {
      return held;
    }
    if (state.suspend && !state.synced && store.read(path) === undefined) {
      return { status: "pending", ready: store.waitForLoad([path]) };
    }
    return PASS;
  };
  return {
    name: "overlay",
    module(path) {
      return gate(path);
    },
    entry(path, key) {
      const read = gate(path);
      if (read.status === "pass") {
        return PASS;
      }
      if (read.status === "pending") {
        return read;
      }
      return entryOfModuleSource(read.source, key, "overlay");
    },
    subscribe(paths, onChange) {
      return store === undefined ? () => {} : store.subscribe(paths)(onChange);
    },
    revision(paths) {
      return store === undefined ? "" : store.revision(paths);
    },
  };
}

/** Where one bundled entry's import is. */
type BundledEntry =
  | { status: "loading"; ready: Promise<void> }
  | { status: "loaded"; content: unknown }
  | { status: "failed"; error: unknown };

/**
 * Every bundled entry's import, started once and kept, by the MODULE OBJECT
 * it belongs to -- the build it came from -- so a new build (or a hot reload)
 * is a new key rather than an old answer. Replaces the frameworks'
 * `jsonEntryPromiseCache`, which was keyed by path and kept a previous
 * build's entries for good.
 *
 * Kept for the process, as the imports themselves are: the module object
 * keeps them alive, and with it the entries the page has read.
 */
const bundledEntries = new WeakMap<object, Map<string, BundledEntry>>();

function bundledEntry(module: object, key: string): EntryRead {
  let entries = bundledEntries.get(module);
  if (entries === undefined) {
    entries = new Map();
    bundledEntries.set(module, entries);
  }
  let entry = entries.get(key);
  if (entry === undefined) {
    const thunk = bundledJsonEntryImport(module, key);
    if (thunk === undefined) {
      return { status: "gone", from: "bundle" };
    }
    const kept = entries;
    const ready = thunk().then(
      (imported) => {
        kept.set(key, { status: "loaded", content: imported.default });
      },
      (error: unknown) => {
        kept.set(key, { status: "failed", error });
      },
    );
    entry = { status: "loading", ready };
    entries.set(key, entry);
  }
  if (entry.status === "loading") {
    return { status: "pending", ready: entry.ready };
  }
  if (entry.status === "failed") {
    return { status: "failed", error: entry.error };
  }
  return { status: "ready", content: entry.content, from: "bundle" };
}

/**
 * The build's own modules: what the code a reader runs was built with. Always
 * the last source, and the only one that never passes on an entry: its
 * entries are its own `import()`s, started when one is first read (never
 * before: a `.jsonValues()` record stays lazy) and kept by build.
 *
 * A module the bundle has passes here: the reader's own selector carries its
 * source, and `stegaEncode` reads it there (and a gallery's from the schema
 * that picks from it), so there is nothing to hand over.
 */
export function bundleSource(
  modules: ReadonlyMap<ModuleFilePath, unknown>,
): ContentSource {
  return {
    name: "bundle",
    module() {
      return PASS;
    },
    entry(path, key) {
      const module = modules.get(path);
      if (typeof module !== "object" || module === null) {
        return PASS;
      }
      return bundledEntry(module, key);
    },
  };
}
