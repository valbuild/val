import { Internal, type Json, type ModuleFilePath } from "@valbuild/core";
import {
  SettledCache,
  type ContentSource,
  type EntryRead,
  type ModuleRead,
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

/**
 * Every bundled entry's import, kept once it has LOADED, by the MODULE OBJECT
 * it belongs to -- the build it came from -- so a new build (or a hot reload)
 * is a new key rather than an old answer. Replaces the frameworks'
 * `jsonEntryPromiseCache`, which was keyed by path and kept a previous
 * build's entries for good.
 *
 * Kept for the process, as the imports themselves are: the module object
 * keeps them alive, and with it the entries the page has read.
 *
 * What is NOT kept for the process is an import still under way, or one
 * that failed: both belong to the read env that started it (a server
 * request's `fetchVal`, a component's renders), the `scope` below. On a
 * server this map outlives every request, and on workerd a promise one
 * request started fails every other request that awaits it once the first
 * has ended -- and so does the import itself, when the visitor who started
 * it has gone, which is a failure of THAT request and must not be the next
 * visitor's. See `SettledCache` in `@valbuild/shared/internal`.
 */
const bundledEntries = new WeakMap<
  object,
  SettledCache<string, { content: unknown }>
>();

/** The imports that failed, by scope, then module, then key. */
const failedEntries = new WeakMap<
  object,
  WeakMap<object, Map<string, { error: unknown; at: number }>>
>();

/** How long a failed entry import answers "failed" before it is tried again. */
export const RETRY_FAILED_ENTRY_AFTER_MS = 5_000;

function failuresOf(
  scope: object,
  module: object,
): Map<string, { error: unknown; at: number }> {
  let byModule = failedEntries.get(scope);
  if (byModule === undefined) {
    byModule = new WeakMap();
    failedEntries.set(scope, byModule);
  }
  let failures = byModule.get(module);
  if (failures === undefined) {
    failures = new Map();
    byModule.set(module, failures);
  }
  return failures;
}

function bundledEntry(module: object, key: string, scope: object): EntryRead {
  let entries = bundledEntries.get(module);
  if (entries === undefined) {
    entries = new SettledCache();
    bundledEntries.set(module, entries);
  }
  const kept = entries.peek(key);
  if (kept !== undefined) {
    return { status: "ready", content: kept.value.content, from: "bundle" };
  }
  const failures = failuresOf(scope, module);
  const failed = failures.get(key);
  if (failed !== undefined) {
    // A chunk that failed to load (a deploy, a dropped connection) is
    // imported again by a read after a while, rather than failing every
    // read until the page is reloaded -- and not by every read before
    // that, each of which would suspend a component again.
    if (Date.now() - failed.at < RETRY_FAILED_ENTRY_AFTER_MS) {
      return { status: "failed", error: failed.error };
    }
    failures.delete(key);
  }
  const thunk = bundledJsonEntryImport(module, key);
  if (thunk === undefined) {
    return { status: "gone", from: "bundle" };
  }
  // The same promise for every read in this scope while it is under way,
  // which `React.use` needs; once loaded, the next read finds it kept.
  const loading = entries.get(
    key,
    () =>
      thunk().then(
        (imported) => ({ content: imported.default }),
        (error: unknown) => {
          failures.set(key, { error, at: Date.now() });
          throw error;
        },
      ),
    scope,
  );
  return { status: "pending", ready: waitFor(loading) };
}

/**
 * A source's wait for `promise`: settled when it is, and the SAME wait for
 * the same promise, which `React.use` needs (one made afresh per read is
 * never seen to settle).
 */
const waits = new WeakMap<Promise<unknown>, Promise<void>>();

function waitFor(promise: Promise<unknown>): Promise<void> {
  let wait = waits.get(promise);
  if (wait === undefined) {
    wait = promise.then(
      () => undefined,
      () => undefined,
    );
    waits.set(promise, wait);
  }
  return wait;
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
  /**
   * Which reads may share an import still under way (see
   * {@link bundledEntries}): the read env, which lives as long as one
   * request's read or one component's render. Without it, the reads of this
   * source.
   */
  scope?: object,
): ContentSource {
  const source: ContentSource = {
    name: "bundle",
    module() {
      return PASS;
    },
    entry(path, key) {
      const module = modules.get(path);
      if (typeof module !== "object" || module === null) {
        return PASS;
      }
      return bundledEntry(module, key, scope ?? source);
    },
  };
  return source;
}
