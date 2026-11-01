import { useCallback, useEffect, useRef, useState } from "react";
import type { ModuleFilePath } from "@valbuild/core";
import { useValSystem, type ValSystem } from "./SystemContext";
import {
  onceBaseAligned,
  sendPendingSources,
  startOverlayRelay,
  subscribeSourceUpdates,
  type OverlayEvent,
} from "./sourceRelay";

// The relay's rules live in `sourceRelay.ts`, as plain functions; these are
// the React bindings. Re-exported for the tests that import it from here.
export { withFilePatchIds } from "./sourceRelay";

/**
 * Whether the store's base is in step with the server's chain, so what it
 * holds can be handed to a page: see {@link onceBaseAligned}. Only waited
 * for while `enabled`.
 */
export function useValBaseAligned(enabled: boolean): boolean {
  const val = useValSystem();
  const system = val?.system ?? null;
  // The system that aligned, so a new system starts out unaligned.
  const [alignedSystem, setAlignedSystem] = useState<
    ValSystem["system"] | null
  >(null);
  useEffect(() => {
    if (!enabled || system === null) return;
    return onceBaseAligned(system, () => setAlignedSystem(system));
  }, [system, enabled]);
  // No system: nothing will be handed over, so there is nothing to wait for.
  return system === null || alignedSystem === system;
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
    return subscribeSourceUpdates(val.system, (path, source) =>
      onUpdateRef.current(path, source),
    );
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
      sendPendingSources(val.system, onUpdate);
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
  const val = useValSystem();
  const send = useCallback((detail: OverlayEvent) => {
    window.dispatchEvent(new CustomEvent("val-event", { detail }));
  }, []);
  /**
   * Changes as they happen, and once the base is aligned, what is already
   * pending followed by `sources-synced` (`startOverlayRelay`).
   *
   * The snapshot is not optional: the subscription only fires on a CHANGE, so
   * a page loaded with edits already in the chain saw none of them -- and a
   * page waiting for draft sources (`suspend`) had nothing to wait for and no
   * way to know that. Not before the base aligns: until then the store can
   * hold the build from before a publish, and this would hand it to a page
   * showing what came after.
   */
  useEffect(() => {
    if (!enabled || val === null) return;
    return startOverlayRelay(val.system, send);
  }, [enabled, val, send]);
  return null;
}
