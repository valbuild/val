import { Internal } from "@valbuild/core";
import type { Json, ModuleFilePath, PatchId } from "@valbuild/core";
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
 * enough — the host already throttles its own `router.refresh()` to 500ms.
 */
const DEBOUNCE_MS = 200;

/**
 * How long a page is kept waiting for the base to align before it is handed
 * what the store holds anyway. Alignment is one `/stat` away, or one base
 * fetch after that; a server that answers neither must not leave the page
 * without the editor's changes -- and a draft page suspends on
 * `sources-synced`, with its own ten second timeout behind this.
 */
const ALIGN_FALLBACK_MS = 5_000;

/**
 * `listener`, once the store's base is the one the server's chain belongs on
 * (`System.onBaseAligned`), or after {@link ALIGN_FALLBACK_MS}.
 *
 * Nothing goes to a page before that. The store starts from the bundle's
 * source, and after a publish that can be the build from before it: a draft
 * page was handed the old text over the new it had just rendered, and then
 * the new text again once the base caught up -- the flicker of a reload in
 * draft mode after a publish.
 */
export function onceBaseAligned(
  system: System,
  listener: () => void,
): () => void {
  let done = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const fire = (fallback: boolean) => {
    if (done) return;
    done = true;
    if (timer !== null) clearTimeout(timer);
    if (fallback) {
      Internal.log.debug(
        "the editor's base did not align in time; handing the page what it holds",
      );
    }
    listener();
  };
  const off = system.onBaseAligned(() => fire(false));
  if (!done) timer = setTimeout(() => fire(true), ALIGN_FALLBACK_MS);
  return () => {
    done = true;
    off();
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
 */
export function emitModuleSource(
  system: System,
  moduleFilePath: ModuleFilePath,
  onUpdate: SourceUpdate,
): void {
  const source = system.sourceStore.moduleSource(moduleFilePath);
  if (source === undefined) {
    return;
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
  if (keys.size > 0) {
    void system.sourceStore.loadEntries(moduleFilePath, [...keys]);
  }
  // The store's own object, unless a pending upload means it has to be copied
  // to carry a `patch_id`. The receiver is a different bundle reading it, never
  // writing it — and cloning a whole module per burst is the cost the debounce
  // exists to avoid paying more than once.
  onUpdate(
    moduleFilePath,
    withFilePatchIds(source, system.patchStore.filePatchIds()),
  );
}

/**
 * Subscribe to module sources moving, debounced and made whole: what
 * `useValSourceUpdates` runs while it is enabled.
 *
 * Changes before the base aligns are collected, not sent: they are sent as the
 * store holds them once it does. See {@link onceBaseAligned}.
 */
export function subscribeSourceUpdates(
  system: System,
  onUpdate: SourceUpdate,
): () => void {
  const pending = new Set<ModuleFilePath>();
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let aligned = false;

  const schedule = () => {
    if (!aligned || timeout !== null || pending.size === 0) return;
    timeout = setTimeout(() => {
      timeout = null;
      const moduleFilePaths = [...pending];
      pending.clear();
      for (const moduleFilePath of moduleFilePaths) {
        emitModuleSource(system, moduleFilePath, onUpdate);
      }
    }, DEBOUNCE_MS);
  };
  const off = system.sourceStore.events.on("source:change", (event) => {
    pending.add(event.moduleFilePath);
    schedule();
  });
  const offAligned = onceBaseAligned(system, () => {
    aligned = true;
    schedule();
  });
  return () => {
    off();
    offAligned();
    if (timeout !== null) clearTimeout(timeout);
  };
}

/**
 * Every module the editor knows a newer value for than the page might, as it
 * stands right now: modules with a pending patch, plus the ones this session
 * has published into. See `useValPendingSourceSnapshot` for why both.
 */
export function sendPendingSources(
  system: System,
  onUpdate: SourceUpdate,
): void {
  const moduleFilePaths = new Set<ModuleFilePath>();
  for (const record of system.patchStore.allRecords()) {
    moduleFilePaths.add(record.moduleFilePath);
  }
  for (const moduleFilePath of system.patchStore.publishedModules()) {
    moduleFilePaths.add(moduleFilePath);
  }
  for (const moduleFilePath of moduleFilePaths) {
    emitModuleSource(system, moduleFilePath, onUpdate);
  }
}

/** What the overlay tells the page behind the Studio. */
export type OverlayEvent =
  | { type: "source-update"; moduleFilePath: ModuleFilePath; source: unknown }
  | { type: "sources-synced" };

/**
 * The overlay's whole relay: changes as they happen, and -- once the base is
 * aligned -- what is already pending, then `sources-synced` to say that was
 * all of it. What `ValOverlayEmitter` runs; the page receives each event as
 * a `val-event`.
 */
export function startOverlayRelay(
  system: System,
  send: (event: OverlayEvent) => void,
): () => void {
  const update: SourceUpdate = (moduleFilePath, source) =>
    send({ type: "source-update", moduleFilePath, source });
  const offUpdates = subscribeSourceUpdates(system, update);
  let stopped = false;
  const offSnapshot = onceBaseAligned(system, () => {
    /*
     * One microtask later, not now. Alignment is announced from inside the
     * stat's commit (`BaseAlignment.commit` -> `adopt`), BEFORE `StatStore`
     * has adopted that stat and handed its chain to the patch store -- so at
     * this moment `allRecords()` does not yet name the pending patches, and
     * the snapshot would be empty. When this ran in a React effect, the
     * re-render in between hid that; as a plain function it has to wait for
     * the adoption, which finishes synchronously after the commit.
     */
    queueMicrotask(() => {
      if (stopped) return;
      sendPendingSources(system, update);
      send({ type: "sources-synced" });
    });
  });
  return () => {
    stopped = true;
    offUpdates();
    offSnapshot();
  };
}
