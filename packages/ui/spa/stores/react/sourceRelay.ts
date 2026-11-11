import { Internal } from "@valbuild/core";
import type { Json, ModuleFilePath } from "@valbuild/core";
import {
  sameModuleVersion,
  type ModuleRead,
  type ModuleVersion,
} from "@valbuild/shared/internal";
import type { System } from "../createSystem";

/**
 * What the editor hands a page: the module sources it holds, and when it has
 * handed over all of them. Plain functions over a `System`, so the overlay
 * (`ValOverlayEmitter`), the canvas (`CanvasFrame`, through the hooks in
 * `ValOverlayEmitter.tsx`) and the scenario harness (`scenarios/`) relay with
 * the same code -- nothing here touches React or `window`.
 */

/**
 * One module, handed to a page: its source as the editor's view holds it, and
 * the version of it the Studio computed (`SourceStore.versionOf`).
 *
 * The source carries a `patch_id` wherever a file of it is still in a patch:
 * the engine marks it where the file lands, as Val's server does on the
 * sources IT serves, so a page that resolves media from what it is sent
 * (`Internal.mediaUrl`) reaches for `/api/val/files/...?patch_id=` instead of a
 * `/public` path with nothing behind it yet. (That was `withFilePatchIds`, a
 * second rule of the Studio's own about where the mark goes, stamped here on
 * every relay until phase 5.)
 */
export type SourceUpdate = (
  moduleFilePath: ModuleFilePath,
  source: unknown,
  version: ModuleVersion | null,
) => void;

/** Whether any of `keys` is an entry `source` holds only as a marker. */
function hasMarkerAt(source: Json, keys: readonly string[]): boolean {
  if (!isJsonObject(source)) return false;
  for (const key of keys) {
    if (
      Object.prototype.hasOwnProperty.call(source, key) &&
      Internal.isJson(source[key])
    ) {
      return true;
    }
  }
  return false;
}

/** A type predicate, so the object branch narrows without an assertion. */
function isJsonObject(value: Json): value is { readonly [key: string]: Json } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * How long a burst of edits is collected before the host page is told.
 *
 * The trigger is `source:change`, which fires on every keystroke-patch and once
 * per landing json-entry batch, and each emission hands the host a whole module
 * source and re-renders every component reading it. One emission per burst is
 * enough: what the page re-reads from its server is driven by `confirmed`,
 * not by these.
 */
const DEBOUNCE_MS = 200;

/**
 * How long a page is kept waiting for the store to be in step with the
 * server before it is handed what the store holds anyway. Being in step is
 * one `/stat` away and one `GET /manifest` after it (and a `GET /modules`
 * for a module this Studio does not hold the version of), and the chain's
 * records one `GET /patches` after that; a server that answers none of them must not
 * leave the page without the editor's changes -- and a draft page suspends
 * on `sources-synced`, with its own ten second timeout behind this.
 *
 * A fallback for a server that does not answer, not how the page converges:
 * everything else here happens on an answer.
 */
const IN_STEP_FALLBACK_MS = 5_000;

/**
 * `listener`, once what the store holds can be handed to a page: it is at the
 * versions the server's manifest names (`System.onInStep`) AND the chain is in
 * the store -- every patch the adopted stat names fetched and applied
 * (`PatchStore.chainSettled`). Or after {@link IN_STEP_FALLBACK_MS}.
 *
 * Nothing goes to a page before that. The store starts from the bundle's
 * source, and after a publish -- or on a site serving a content version --
 * that is not what the server has: a draft page was handed the old text over
 * the new it had just rendered, and then the new text again once the store
 * caught up -- the flicker of a reload in draft mode after a publish.
 *
 * And being in step alone is not enough (S24b, `scenarios/`): it is announced
 * from inside the stat's commit, before the stat names its patches to the
 * patch store, and their records are fetched after that. A page told
 * `sources-synced` then had been sent nothing for the module with the
 * pending edit, and a page that suspends stopped waiting and rendered the
 * published content -- `notFound()` for a route that exists only in the
 * patch.
 */
export function onceInStep(system: System, listener: () => void): () => void {
  let done = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let offChain = () => {};
  const fire = (fallback: boolean) => {
    if (done) return;
    done = true;
    if (timer !== null) clearTimeout(timer);
    offChain();
    if (fallback) {
      Internal.log.debug(
        "the editor's store did not come into step with the server in time; handing the page what it holds",
      );
    }
    listener();
  };
  const offAligned = system.onInStep(() => {
    /*
     * One microtask later, not now. Being in step is announced from inside
     * the manifest's adoption (`ManifestSource`), which follows a stat whose
     * records the patch store may still be fetching -- so the chain is
     * waited for too, and asked once the adoption has finished.
     */
    queueMicrotask(() => {
      if (done) return;
      const patchStore = system.patchStore;
      if (patchStore.chainSettled()) {
        fire(false);
        return;
      }
      // The records arrive (`patch:chain`) and are applied (`patch:head`,
      // from the source store's apply): `chainSettled` needs both.
      const check = () => {
        if (patchStore.chainSettled()) fire(false);
      };
      const offRecords = patchStore.events.on("patch:chain", check);
      const offApplied = patchStore.events.on("patch:head", check);
      offChain = () => {
        offRecords();
        offApplied();
      };
    });
  });
  if (!done) timer = setTimeout(() => fire(true), IN_STEP_FALLBACK_MS);
  return () => {
    done = true;
    offAligned();
    offChain();
    if (timer !== null) clearTimeout(timer);
  };
}

/**
 * Read one module's source as it stands, and hand it over.
 *
 * Shared by the subscription below and by the snapshot after it, because the
 * `.jsonValues()` handling is the part that is easy to get wrong and impossible
 * to notice — an entry the user edited but never opened is a marker in source,
 * so the receiver falls back to committed content and the edit looks lost.
 *
 * Resolves once the module has been handed over: at once, or -- when it is
 * held back for entries a publish wrote -- once they are read.
 */
export function emitModuleSource(
  system: System,
  moduleFilePath: ModuleFilePath,
  onUpdate: SourceUpdate,
  /** Set once the entries this waited for have been read: see below. */
  afterLoad: boolean = false,
): Promise<void> {
  const source = system.sourceStore.moduleSource(moduleFilePath);
  if (source === undefined) {
    return Promise.resolve();
  }
  /**
   * The entries whose content in the editor's view is not what the
   * receiver's bundle has (`SourceStore.entriesToRelay`): every entry the
   * chain wrote or edited -- the engine knows which, renames included -- and
   * every one whose marker says a publish wrote it, on a host that has not
   * rebuilt since (`Internal.isJsonFromServer`). The same entries the server's
   * draft read fills for a page. The ones still a marker are asked for; when
   * they land the module changes again and the subscription runs with real
   * content.
   */
  const keys = system.sourceStore.entriesToRelay(moduleFilePath);
  /**
   * Held back until those entries are here. The page already shows them: its
   * server render read them from the server too (`serverDraftSource`), and a
   * marker handed over now would REPLACE that with the bundle's copy until the
   * content followed -- the published entry, then the one from before the
   * publish, then the published one again; or, for an entry a pending patch
   * edits, the entry without the edit and then with it.
   *
   * Sent once the read is over whatever it found: an entry that loaded is in
   * the source by then, and one that failed is a marker the page can only
   * fill from its bundle, which is no worse than sending it now.
   */
  if (keys.length > 0 && !afterLoad && hasMarkerAt(source, keys)) {
    const loading = system.sourceStore.loadEntries(moduleFilePath, keys);
    return loading.then(
      () => emitModuleSource(system, moduleFilePath, onUpdate, true),
      () => emitModuleSource(system, moduleFilePath, onUpdate, true),
    );
  }
  // The store's own object. The receiver is a different bundle reading it,
  // never writing it.
  onUpdate(
    moduleFilePath,
    source,
    system.sourceStore.versionOf(moduleFilePath) ?? null,
  );
  return Promise.resolve();
}

/**
 * Subscribe to module sources moving, debounced and made whole: what
 * `useValSourceUpdates` runs while it is enabled.
 *
 * Changes before the store is in step are collected, not sent: they are sent
 * as the store holds them once it is. See {@link onceInStep}.
 */
export function subscribeSourceUpdates(
  system: System,
  onUpdate: SourceUpdate,
  /**
   * What the page reported holding when it connected: a module collected
   * before the store was in step that the page holds at the version the
   * store is at now is the page's already, and is not sent. Only those: a
   * change after that is news whatever the page started with.
   */
  holdsVersions: () => HeldVersions = () => ({}),
): () => void {
  const pending = new Set<ModuleFilePath>();
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let inStep = false;

  const schedule = () => {
    if (!inStep || timeout !== null || pending.size === 0) return;
    timeout = setTimeout(() => {
      timeout = null;
      const moduleFilePaths = [...pending];
      pending.clear();
      for (const moduleFilePath of moduleFilePaths) {
        void emitModuleSource(system, moduleFilePath, onUpdate);
      }
    }, DEBOUNCE_MS);
  };
  const off = system.sourceStore.events.on("source:change", (event) => {
    pending.add(event.moduleFilePath);
    schedule();
  });
  const offInStep = onceInStep(system, () => {
    inStep = true;
    const held = holdsVersions();
    for (const moduleFilePath of [...pending]) {
      if (holdsAtOurVersion(system, held, moduleFilePath)) {
        pending.delete(moduleFilePath);
      }
    }
    schedule();
  });
  return () => {
    off();
    offInStep();
    if (timeout !== null) clearTimeout(timeout);
  };
}

/**
 * Every module the editor knows a newer value for than the page might, as it
 * stands right now: modules with a pending patch, plus the ones this session
 * has published into, plus every module the PAGE says it holds a draft of
 * (`holds`) -- the page reporting what it was rendered with, so a draft that
 * is no longer the draft (discarded, or published, before the page's Studio
 * was there to see it) is replaced with what the editor holds rather than
 * kept for good. The page compares what it is sent with what it holds, so a
 * module that has not moved costs it nothing.
 *
 * A held `.jsonValues()` module goes too, whatever of its entries the store
 * has read: `emitModuleSource` holds it back until the entries the page's
 * server read filled from the server are here (the ones the chain touches and
 * the ones a publish wrote: `SourceStore.entriesToRelay`), and every other
 * entry is a marker on both sides, which the page fills from its bundle, as
 * its server render did. Until phase 5 the store could not say which entries
 * its chain touched, so such a module stayed as the page was rendered.
 *
 * Resolves once every one of them has been handed over, including a module
 * held back for its entries (`emitModuleSource`): `sources-synced` follows
 * it, and must not overtake it.
 */
export async function sendPendingSources(
  system: System,
  onUpdate: SourceUpdate,
  holds: readonly ModuleFilePath[] = [],
  /**
   * The version the page holds each of `holds` at, where it says
   * (`draftHoldsVersions`): a module the page holds at the version this
   * Studio would send is the same content, and is not sent again.
   */
  holdsVersions: HeldVersions = {},
): Promise<void> {
  const moduleFilePaths = new Set<ModuleFilePath>();
  for (const record of system.patchStore.allRecords()) {
    moduleFilePaths.add(record.moduleFilePath);
  }
  for (const moduleFilePath of system.patchStore.publishedModules()) {
    moduleFilePaths.add(moduleFilePath);
  }
  for (const moduleFilePath of holds) {
    moduleFilePaths.add(moduleFilePath);
  }
  await Promise.all(
    [...moduleFilePaths]
      .filter((moduleFilePath) => {
        return !holdsAtOurVersion(system, holdsVersions, moduleFilePath);
      })
      .map((moduleFilePath) =>
        emitModuleSource(system, moduleFilePath, onUpdate),
      ),
  );
}

/** What a page says it holds each module at. See {@link sendPendingSources}. */
export type HeldVersions = Readonly<
  Partial<Record<ModuleFilePath, ModuleVersion>>
>;

/**
 * Whether the page holds this module at the version the store holds it:
 * the same content (a version names what a reader renders), so sending it
 * again is a message for nothing.
 */
function holdsAtOurVersion(
  system: System,
  holdsVersions: HeldVersions,
  moduleFilePath: ModuleFilePath,
): boolean {
  const held = holdsVersions[moduleFilePath];
  const ours = system.sourceStore.versionOf(moduleFilePath);
  return (
    held !== undefined && ours !== undefined && sameModuleVersion(held, ours)
  );
}

/**
 * "The server holds the editor's changes up to this version": the `seq` the
 * server answered at (`ProjectVersion.seq`), each time it moves.
 *
 * What a page re-reads its server-read content on (`startRefreshLoop` in
 * `@valbuild/react/stega`): a loader or a server component only shows an
 * edit once the server has it, so the refresh is sent when the server has
 * confirmed it, not when it is typed -- typed, it raced the write and came
 * back without the edit (S05, `scenarios/`). It replaces the page's timer.
 *
 * Told on what the server answered, and nothing else: a stat the stores
 * adopted (the editor's own save, another editor's, a discard, a publish,
 * a new build), and in `http` mode a save's own answer, which names the
 * chain version it made a stat earlier. A save's answer without a version
 * (`fs`, `memory`) says nothing here: the stat that follows it does.
 */
export function subscribeConfirmed(
  system: System,
  listener: (seq: number) => void,
): () => void {
  const offStat = system.stat.events.on("stat:receive", (event) => {
    if (event.seq !== undefined) listener(event.seq);
  });
  const offSaved = system.patchSync.events.on("patch:saved", (event) => {
    if (event.headVersion !== undefined) listener(event.headVersion);
  });
  return () => {
    offStat();
    offSaved();
  };
}

/** What a page is caught up with, and then told as the server moves. */
export type CatchUp = {
  /** Hand over one module; `null` sends none (the canvas, relaying off). */
  update: SourceUpdate | null;
  /**
   * What the page says it holds a draft of (see {@link sendPendingSources}),
   * asked when the store is in step: the report can arrive after the relay
   * started.
   */
  holds(): readonly ModuleFilePath[];
  /** The version it holds each of them at, where it says. */
  holdsVersions?(): HeldVersions;
  /** Everything the editor holds for the page has been handed over. */
  synced(): void;
  /**
   * The server holds the editor's changes up to `seq` (see
   * {@link subscribeConfirmed}): once after `synced`, with what the store
   * was in step with (`null` from a server that reports no version), then
   * every time it moves forward. Never with `update: null`.
   */
  confirmed(seq: number | null): void;
};

/**
 * Catch a page that has just started listening up with what the editor
 * holds, say that was all of it, and from then on say how far the server
 * has confirmed the editor's changes. The overlay and the canvas each run
 * one per document (`startOverlayRelay`, `useValCatchUp`).
 */
export function startCatchUp(system: System, page: CatchUp): () => void {
  let stopped = false;
  let offConfirmed = () => {};
  const offInStep = onceInStep(system, () => {
    const sent =
      page.update === null
        ? Promise.resolve()
        : sendPendingSources(
            system,
            page.update,
            page.holds(),
            page.holdsVersions?.() ?? {},
          );
    void sent.then(() => {
      if (stopped) return;
      page.synced();
      // A page this Studio relays nothing to (a proposal's, reading its own
      // drafts) is not refreshed by what this Studio's server confirms:
      // that is about other content.
      if (page.update === null) return;
      let told = system.stat.currentSeq() ?? null;
      page.confirmed(told);
      offConfirmed = subscribeConfirmed(system, (seq) => {
        // Two answers can confirm one version (a save's, then the stat
        // after it), and a late answer an older one: told once, forward.
        if (told !== null && seq <= told) return;
        told = seq;
        page.confirmed(seq);
      });
    });
  });
  return () => {
    stopped = true;
    offInStep();
    offConfirmed();
  };
}

/**
 * A module, as the Studio hands it to a page: a READ (`ModuleRead` in
 * `@valbuild/shared/internal`), which the page's `overlaySource` keeps as it
 * is (`docs/plans/one-content-model.md`, "The relay sends the page exactly
 * what the view answered"), with the version the Studio computed for it.
 */
export function relayedRead(
  source: unknown,
  version: ModuleVersion | null,
): ModuleRead | null {
  return isRelayable(source)
    ? { status: "ready", source, from: "overlay", version }
    : null;
}

/**
 * What the Studio's store holds is JSON: it came from the bundle, the server
 * or a patch. `undefined` is the one thing that is not, and is not sent.
 */
function isRelayable(source: unknown): source is Json {
  return source !== undefined;
}

/** What the overlay tells the page behind the Studio. */
export type OverlayEvent =
  | {
      type: "source-update";
      moduleFilePath: ModuleFilePath;
      read: ModuleRead;
    }
  | { type: "sources-synced" }
  /** The server holds the editor's changes up to `seq`: {@link CatchUp}. */
  | { type: "confirmed"; seq: number | null };

/** What the page behind the overlay reports when the overlay connects. */
export type PageReport = {
  /** The modules it holds a draft of: see {@link sendPendingSources}. */
  holds(): readonly ModuleFilePath[];
  /** The version it holds each at, where it says. */
  holdsVersions?(): HeldVersions;
};

const NOTHING_HELD: PageReport = { holds: () => [] };

/**
 * The overlay's whole relay: changes as they happen, and -- once the store is
 * in step with the server -- what is pending (and what the page holds), then
 * `sources-synced` to say that was all of it, then `confirmed` as the server
 * takes the editor's changes. What `ValOverlayEmitter` runs; the page
 * receives each event as a `val-event`.
 */
export function startOverlayRelay(
  system: System,
  send: (event: OverlayEvent) => void,
  page: PageReport = NOTHING_HELD,
): () => void {
  const update: SourceUpdate = (moduleFilePath, source, version) => {
    const read = relayedRead(source, version);
    if (read !== null) {
      send({ type: "source-update", moduleFilePath, read });
    }
  };
  const offUpdates = subscribeSourceUpdates(
    system,
    update,
    () => page.holdsVersions?.() ?? {},
  );
  const offCatchUp = startCatchUp(system, {
    update,
    holds: () => page.holds(),
    holdsVersions: () => page.holdsVersions?.() ?? {},
    synced: () => send({ type: "sources-synced" }),
    confirmed: (seq) => send({ type: "confirmed", seq }),
  });
  return () => {
    offUpdates();
    offCatchUp();
  };
}
