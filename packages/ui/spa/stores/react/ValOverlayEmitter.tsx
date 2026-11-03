import { useCallback, useEffect, useRef } from "react";
import type { ModuleFilePath } from "@valbuild/core";
import type { ModuleVersion } from "@valbuild/shared/internal";
import { useValSystem } from "./SystemContext";
import {
  startCatchUp,
  startOverlayRelay,
  subscribeSourceUpdates,
  type CatchUp,
  type OverlayEvent,
  type HeldVersions,
} from "./sourceRelay";

// The relay's rules live in `sourceRelay.ts`, as plain functions; these are
// the React bindings.

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
  onUpdate: (
    moduleFilePath: ModuleFilePath,
    source: unknown,
    version: ModuleVersion | null,
  ) => void,
  /** What the page reported holding: see `subscribeSourceUpdates`. */
  holdsVersions?: () => HeldVersions,
): void {
  const val = useValSystem();
  // Held in a ref so a caller can pass an inline function without the
  // subscription being torn down and rebuilt on every render — which would
  // drop whatever was mid-debounce each time.
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const holdsVersionsRef = useRef(holdsVersions);
  holdsVersionsRef.current = holdsVersions;
  useEffect(() => {
    if (!enabled || val === null) {
      return;
    }
    return subscribeSourceUpdates(
      val.system,
      (path, source, version) => onUpdateRef.current(path, source, version),
      () => holdsVersionsRef.current?.() ?? {},
    );
  }, [val, enabled]);
}

/**
 * Catch a page up the moment it is listening, say that was all of it, and
 * then say how far the server has confirmed the editor's changes
 * (`startCatchUp`), once per `document` -- a key that changes with every new
 * document the page is.
 *
 * The relay above only carries a *change*, which is the wrong shape for
 * something that has just started listening. A canvas frame gets its content
 * from the server when the page is requested, and there are reasons that
 * render can miss uncommitted work — a cached route, a patch written after the
 * request went out — so a freshly loaded canvas sometimes showed the published
 * page while the editor beside it showed the edit, and stayed that way until
 * the next keystroke happened to relay one.
 *
 * The modules sent are the pending ones, the ones this session has published
 * into (publishing rewrites the `.val.ts` files, `next dev` reloads the page,
 * and a page rendered by a server that had not picked the new file up sat on
 * pre-publish content), and the ones the page says it holds a draft of.
 */
export function useValCatchUp(
  enabled: boolean,
  document: unknown,
  page: CatchUp,
): void {
  const val = useValSystem();
  // The callbacks are the caller's, often inline: read through a ref, so a
  // render does not start the catch-up again.
  const pageRef = useRef(page);
  pageRef.current = page;
  const relays = page.update !== null;
  useEffect(() => {
    if (!enabled) return;
    if (val === null) {
      // No system: nothing will be handed over, so there is nothing to wait
      // for -- but the page still has to be told so.
      pageRef.current.synced();
      return;
    }
    return startCatchUp(val.system, {
      update: relays
        ? (path, source, version) =>
            pageRef.current.update?.(path, source, version)
        : null,
      holds: () => pageRef.current.holds(),
      holdsVersions: () => pageRef.current.holdsVersions?.() ?? {},
      synced: () => pageRef.current.synced(),
      confirmed: (seq) => pageRef.current.confirmed(seq),
    });
  }, [val, enabled, document, relays]);
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
export function ValOverlayEmitter({
  enabled,
  pageHolds,
  pageHoldsVersions,
}: {
  enabled: boolean;
  /**
   * The modules the page behind the overlay holds a draft of, as it
   * reported them (`draftMode` on `val-overlay-spa`): sent in the catch-up
   * whether or not anything is pending for them. See `sendPendingSources`.
   */
  pageHolds?: readonly ModuleFilePath[];
  /** The version it holds each at, where it says: not sent again. */
  pageHoldsVersions?: HeldVersions;
}) {
  const val = useValSystem();
  const send = useCallback((detail: OverlayEvent) => {
    window.dispatchEvent(new CustomEvent("val-event", { detail }));
  }, []);
  const holdsRef = useRef<readonly ModuleFilePath[]>(pageHolds ?? []);
  holdsRef.current = pageHolds ?? [];
  const holdsVersionsRef = useRef<HeldVersions>(pageHoldsVersions ?? {});
  holdsVersionsRef.current = pageHoldsVersions ?? {};
  /**
   * Changes as they happen, and once the store is in step, what is already
   * pending followed by `sources-synced`, then `confirmed` as the server
   * takes the editor's changes (`startOverlayRelay`).
   *
   * The snapshot is not optional: the subscription only fires on a CHANGE, so
   * a page loaded with edits already in the chain saw none of them -- and a
   * page waiting for draft sources (`suspend`) had nothing to wait for and no
   * way to know that. Not before the store is in step: until then it can
   * hold the build from before a publish, and this would hand it to a page
   * showing what came after.
   */
  useEffect(() => {
    if (!enabled || val === null) return;
    return startOverlayRelay(val.system, send, {
      holds: () => holdsRef.current,
      holdsVersions: () => holdsVersionsRef.current,
    });
  }, [enabled, val, send]);
  return null;
}
