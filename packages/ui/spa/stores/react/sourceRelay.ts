import { Internal } from "@valbuild/core";
import type { Json, ModuleFilePath, PatchId } from "@valbuild/core";
import type { ModuleRead } from "@valbuild/shared/internal";
import type { System } from "../createSystem";

/**
 * What the editor hands a page: the module sources it holds, and when it has
 * handed over all of them. Plain functions over a `System`, so the overlay
 * (`ValOverlayEmitter`), the canvas (`CanvasFrame`, through the hooks in
 * `ValOverlayEmitter.tsx`) and the scenario harness (`scenarios/`) relay with
 * the same code -- nothing here touches React or `window`.
 */

/** One module's source, handed to a page. */
export type SourceUpdate = (
  moduleFilePath: ModuleFilePath,
  source: unknown,
) => void;

/**
 * Stamp `patch_id` onto media whose bytes are still in a patch.
 *
 * The host page turns a media source into a URL with `Internal.mediaUrl`, and
 * that needs `patch_id` to reach for `/api/val/files/...?patch_id=` instead of
 * the committed `/public` path. The server sets it on the sources IT serves;
 * the Studio's own store never carries it — the editor's fields get it from
 * `patchStore.filePatchIds()` separately. So a page that resolves media from
 * what this emitter sends was pointing every freshly uploaded image at a path
 * with no file behind it yet, and the image silently did not load.
 *
 * Which values are media is normally the SCHEMA's answer, never the value's.
 * The test here is neither: `filePatchIds` is keyed by the `filePath` of a real
 * `file` op, so a `path` that is a key in it is a file this session has
 * uploaded and not yet published. A non-media object would have to hold that
 * exact string to be touched, and would gain an unread sibling if it did.
 *
 * Structurally shared: an unchanged subtree comes back by reference, so a
 * module with no pending files is the same object it was, and
 * `ValExternalStore`'s equality check on the receiving side still short-circuits.
 */
export function withFilePatchIds(
  value: Json,
  filePatchIds: ReadonlyMap<string, PatchId>,
): Json {
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const mapped = withFilePatchIds(item, filePatchIds);
      if (mapped !== item) changed = true;
      return mapped;
    });
    return changed ? next : value;
  }
  if (!isJsonObject(value)) {
    return value;
  }
  let changed = false;
  const next: { [key: string]: Json } = {};
  for (const [key, item] of Object.entries(value)) {
    const mapped = withFilePatchIds(item, filePatchIds);
    if (mapped !== item) changed = true;
    next[key] = mapped;
  }
  const path = value["path"];
  if (typeof path === "string") {
    const patchId = filePatchIds.get(path);
    if (patchId !== undefined && value["patch_id"] !== patchId) {
      next["patch_id"] = patchId;
      changed = true;
    }
  }
  return changed ? next : value;
}

/** Whether any of `keys` is an entry `source` holds only as a marker. */
function hasMarkerAt(source: Json, keys: ReadonlySet<string>): boolean {
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
 * server before it is handed what the store holds anyway. Alignment is one
 * `/stat` away, or one base fetch after that, and the chain's records one
 * `GET /patches` after that; a server that answers none of them must not
 * leave the page without the editor's changes -- and a draft page suspends
 * on `sources-synced`, with its own ten second timeout behind this.
 *
 * A fallback for a server that does not answer, not how the page converges:
 * everything else here happens on an answer.
 */
const IN_STEP_FALLBACK_MS = 5_000;

/**
 * `listener`, once what the store holds can be handed to a page: its base is
 * the one the server's chain belongs on (`System.onBaseAligned`) AND that
 * chain is in the store -- every patch the adopted stat names fetched and
 * applied (`PatchStore.chainSettled`). Or after {@link IN_STEP_FALLBACK_MS}.
 *
 * Nothing goes to a page before that. The store starts from the bundle's
 * source, and after a publish that can be the build from before it: a draft
 * page was handed the old text over the new it had just rendered, and then
 * the new text again once the base caught up -- the flicker of a reload in
 * draft mode after a publish.
 *
 * And alignment alone is not enough (S24b, `scenarios/`): it is announced
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
  const offAligned = system.onBaseAligned(() => {
    /*
     * One microtask later, not now. Alignment is announced from inside the
     * stat's commit (`BaseAlignment.commit` -> `adopt`), BEFORE `StatStore`
     * has adopted that stat and handed its chain to the patch store -- so at
     * this moment `chainSettled()` answers for the chain from BEFORE (empty,
     * on a first stat). The adoption finishes synchronously after the commit.
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
   * Ask for the entries this module's own patches touch; when they land the
   * module changes again and the subscription runs with real content.
   *
   * Derived from the patch ops rather than tracked: the first segment of an op
   * path IS the record key, so the set of entries an edit could have touched is
   * exactly what the chain says.
   */
  const keys = new Set<string>();
  for (const record of system.patchStore.allRecords()) {
    if (record.moduleFilePath !== moduleFilePath) continue;
    for (const op of record.patch) {
      const key = op.path[0];
      if (typeof key === "string") keys.add(key);
      // And where a rename takes the entry FROM: its content has to be here
      // for the move to carry it, or the new key is a marker for an entry
      // the page's bundle does not have.
      const from =
        op.op === "move" || op.op === "copy" ? op.from[0] : undefined;
      if (typeof from === "string") keys.add(from);
    }
  }
  /**
   * And the entries whose marker says the receiver's bundle does not have
   * them (`Internal.isJsonFromServer`): ones a publish wrote, on a host that
   * has not rebuilt since. No pending patch names them any more, so without
   * this the receiver filled them from its bundle -- the content from before
   * the publish.
   */
  let fromServer = false;
  if (isJsonObject(source)) {
    for (const [key, value] of Object.entries(source)) {
      if (!Internal.isJsonFromServer(value)) continue;
      keys.add(key);
      fromServer = true;
    }
  }
  const loading =
    keys.size > 0
      ? system.sourceStore.loadEntries(moduleFilePath, [...keys])
      : null;
  /**
   * Held back until those entries are here, if any of them is still a
   * marker. The page already shows them: its server render read them from
   * the server too (`serverDraftSource`), and a marker handed over now would
   * REPLACE that with the bundle's copy until the content followed -- the
   * published entry, then the one from before the publish, then the
   * published one again; or, for an entry a pending patch edits, the entry
   * without the edit and then with it. (The catch-up used to go out before
   * the chain's records were in, so it never named such an entry and the
   * markers only went with the changes after it; see `onceInStep`.)
   *
   * Sent once the read is over whatever it found: an entry that loaded is in
   * the source by then, and one that failed is a marker the page can only
   * fill from its bundle, which is no worse than sending it now. An entry
   * already loaded holds nothing back.
   */
  if (
    loading !== null &&
    !afterLoad &&
    (fromServer || hasMarkerAt(source, keys))
  ) {
    return loading.then(
      () => emitModuleSource(system, moduleFilePath, onUpdate, true),
      () => emitModuleSource(system, moduleFilePath, onUpdate, true),
    );
  }
  // The store's own object, unless a pending upload means it has to be copied
  // to carry a `patch_id`. The receiver is a different bundle reading it, never
  // writing it — and cloning a whole module per burst is the cost the debounce
  // exists to avoid paying more than once.
  onUpdate(
    moduleFilePath,
    withFilePatchIds(source, system.patchStore.filePatchIds()),
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
 * module that has not moved costs it nothing. (Not yet a held module with
 * `.jsonValues()` entries the store has not loaded: see below.)
 *
 * Resolves once every one of them has been handed over, including a module
 * held back for its entries (`emitModuleSource`): `sources-synced` follows
 * it, and must not overtake it.
 */
export async function sendPendingSources(
  system: System,
  onUpdate: SourceUpdate,
  holds: readonly ModuleFilePath[] = [],
): Promise<void> {
  const moduleFilePaths = new Set<ModuleFilePath>();
  for (const record of system.patchStore.allRecords()) {
    moduleFilePaths.add(record.moduleFilePath);
  }
  for (const moduleFilePath of system.patchStore.publishedModules()) {
    moduleFilePaths.add(moduleFilePath);
  }
  for (const moduleFilePath of holds) {
    if (moduleFilePaths.has(moduleFilePath)) continue;
    /*
     * Not one whose `.jsonValues()` entries the store has not all loaded: it
     * would go as markers, which the page fills from its BUNDLE -- over
     * entries its server read filled from the server (one a publish wrote,
     * say), the content from before. Telling the two apart takes the page's
     * versions, which the relay has from phase 5; until then such a module
     * stays as the page was rendered.
     */
    if (system.sourceStore.hasUnloadedEntries(moduleFilePath)) continue;
    moduleFilePaths.add(moduleFilePath);
  }
  await Promise.all(
    [...moduleFilePaths].map((moduleFilePath) =>
      emitModuleSource(system, moduleFilePath, onUpdate),
    ),
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
  /** Everything the editor holds for the page has been handed over. */
  synced(): void;
  /**
   * The server holds the editor's changes up to `seq` (see
   * {@link subscribeConfirmed}): once after `synced`, with what the store
   * was in step with (`null` from a server that reports no version), then
   * every time it moves forward.
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
        : sendPendingSources(system, page.update, page.holds());
    void sent.then(() => {
      if (stopped) return;
      page.synced();
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
 * what the view answered"). Its version is `null` until the Studio computes
 * its own (phase 5).
 */
export function relayedRead(source: unknown): ModuleRead | null {
  return isRelayable(source)
    ? { status: "ready", source, from: "overlay", version: null }
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
      /**
       * The same source as `read`, for a page from the release before,
       * which reads this (a deploy rolling out). Goes when that release
       * does: see "Each phase deletes" in the plan.
       */
      source: unknown;
    }
  | { type: "sources-synced" }
  /** The server holds the editor's changes up to `seq`: {@link CatchUp}. */
  | { type: "confirmed"; seq: number | null };

/** What the page behind the overlay reports when the overlay connects. */
export type PageReport = {
  /** The modules it holds a draft of: see {@link sendPendingSources}. */
  holds(): readonly ModuleFilePath[];
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
  const update: SourceUpdate = (moduleFilePath, source) => {
    const read = relayedRead(source);
    if (read !== null) {
      send({ type: "source-update", moduleFilePath, read, source });
    }
  };
  const offUpdates = subscribeSourceUpdates(system, update);
  const offCatchUp = startCatchUp(system, {
    update,
    holds: () => page.holds(),
    synced: () => send({ type: "sources-synced" }),
    confirmed: (seq) => send({ type: "confirmed", seq }),
  });
  return () => {
    offUpdates();
    offCatchUp();
  };
}
