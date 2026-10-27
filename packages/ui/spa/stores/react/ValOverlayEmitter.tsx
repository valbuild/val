import { useCallback, useEffect, useRef } from "react";
import type { Json, ModuleFilePath, PatchId } from "@valbuild/core";
import { useValSystem, type ValSystem } from "./SystemContext";

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
 * Read one module's source as it stands, and hand it over.
 *
 * Shared by the subscription below and by the snapshot after it, because the
 * `.jsonValues()` handling is the part that is easy to get wrong and impossible
 * to notice — an entry the user edited but never opened is a marker in source,
 * so the receiver falls back to committed content and the edit looks lost.
 */
function emitModuleSource(
  system: ValSystem["system"],
  moduleFilePath: ModuleFilePath,
  onUpdate: (moduleFilePath: ModuleFilePath, source: unknown) => void,
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
 * Subscribe to module sources moving, debounced and made whole.
 *
 * Split out from the component below because there are now two places a
 * customer's page can be: behind the Studio, sharing its window, and inside the
 * canvas, which is a different document reached by `postMessage`. Both need the
 * same payload and the same debounce, and neither should own a second copy of
 * the rules for building it.
 */
export function useValSourceUpdates(
  enabled: boolean,
  onUpdate: (moduleFilePath: ModuleFilePath, source: unknown) => void,
): void {
  const val = useValSystem();
  // Held in a ref so a caller can pass an inline function without the
  // subscription being torn down and rebuilt on every render — which would
  // drop whatever was mid-debounce each time.
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  useEffect(() => {
    if (!enabled || val === null) {
      return;
    }
    const system = val.system;
    const pending = new Set<ModuleFilePath>();
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const emit = (moduleFilePath: ModuleFilePath) =>
      emitModuleSource(system, moduleFilePath, (path, source) =>
        onUpdateRef.current(path, source),
      );

    const off = system.sourceStore.events.on("source:change", (event) => {
      pending.add(event.moduleFilePath);
      if (timeout !== null) return;
      timeout = setTimeout(() => {
        timeout = null;
        const moduleFilePaths = [...pending];
        pending.clear();
        for (const moduleFilePath of moduleFilePaths) {
          emit(moduleFilePath);
        }
      }, DEBOUNCE_MS);
    });
    return () => {
      off();
      if (timeout !== null) clearTimeout(timeout);
    };
  }, [val, enabled]);
}

/**
 * Every module the editor knows a newer value for than the page might, as it
 * stands right now.
 *
 * The subscription above only fires on a *change*, which is the wrong shape for
 * something that has just started listening. A canvas frame gets its content
 * from the server when the page is requested, and there are reasons that render
 * can miss uncommitted work — a cached route, a patch written after the request
 * went out — so a freshly loaded canvas sometimes showed the published page
 * while the editor beside it showed the edit, and stayed that way until the next
 * keystroke happened to relay one.
 *
 * Modules with a pending patch rather than everything the page reports: those
 * are exactly the ones whose content could disagree, the set is small, and it
 * does not need to know anything about the page.
 *
 * PLUS the modules this session has published into, which the pending set stops
 * naming the moment the publish lands. That gap is what auto-save turned into a
 * routine failure: publishing rewrites the `.val.ts` files, `next dev` reloads
 * the page on the change, and the fresh document is caught up with a snapshot
 * that now has nothing to send — followed by `sourcesSynced`, which tells the
 * page to render committed source. If that render came from a server that had
 * not picked the new file up, the canvas sat on pre-publish content until the
 * next keystroke put a patch back in the chain. The editor's own source for a
 * published module IS the published value, so sending it is both correct and
 * idempotent.
 */
export function useValPendingSourceSnapshot(): (
  onUpdate: (moduleFilePath: ModuleFilePath, source: unknown) => void,
) => void {
  const val = useValSystem();
  return useCallback(
    (onUpdate) => {
      if (val === null) {
        return;
      }
      const system = val.system;
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
    },
    [val],
  );
}

/**
 * Tell the host page that a module's source moved.
 *
 * The Val overlay renders the CUSTOMER's app, not the Studio: their components
 * read committed source through `useValStega`, and without this they would keep
 * showing it while the editor's own fields showed the edit. The event is what
 * makes an inline edit visible on the page behind the Studio.
 *
 * A component rather than a store, and deliberately: `window.dispatchEvent` is a
 * DOM effect, and nothing in `stores/` touches `window` — that is what lets the
 * whole store graph run in a worker and in a node test. See `StoreBus`.
 */
export function ValOverlayEmitter({ enabled }: { enabled: boolean }) {
  const emit = useCallback(
    (moduleFilePath: ModuleFilePath, source: unknown) => {
      window.dispatchEvent(
        new CustomEvent("val-event", {
          detail: { type: "source-update", moduleFilePath, source },
        }),
      );
    },
    [],
  );
  useValSourceUpdates(enabled, emit);
  /**
   * Hand over what is already pending, then say that was all of it.
   *
   * The subscription above only fires on a CHANGE, so a page loaded with edits
   * already in the chain saw none of them — and a page waiting for draft
   * sources (`suspend`) had nothing to wait for and no way to know that. The
   * canvas has had the snapshot half of this since it was a separate document;
   * the overlay shares the window and was missed.
   */
  const sendPendingSources = useValPendingSourceSnapshot();
  useEffect(() => {
    if (!enabled) return;
    sendPendingSources(emit);
    window.dispatchEvent(
      new CustomEvent("val-event", { detail: { type: "sources-synced" } }),
    );
  }, [enabled, sendPendingSources, emit]);
  return null;
}
