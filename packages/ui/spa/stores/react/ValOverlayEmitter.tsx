import { useEffect } from "react";
import type { ModuleFilePath } from "@valbuild/core";
import { useValSystem } from "./SystemContext";

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
  useEffect(() => {
    if (!enabled || val === null) {
      return;
    }
    const system = val.system;
    const pending = new Set<ModuleFilePath>();
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const emit = (moduleFilePath: ModuleFilePath) => {
      const source = system.sourceStore.moduleSource(moduleFilePath);
      if (source === undefined) {
        return;
      }
      /**
       * A `.jsonValues()` entry the user has edited but never opened this
       * session is still a marker in source, so the host would fall back to the
       * committed content and the edit would look lost. Ask for the entries the
       * module's own patches touch; when they land the module changes again and
       * this runs once more with real content.
       *
       * Derived from the patch ops rather than tracked: the first segment of an
       * op path IS the record key, so the set of entries an edit could have
       * touched is exactly what the chain says.
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
      window.dispatchEvent(
        new CustomEvent("val-event", {
          detail: {
            type: "source-update",
            moduleFilePath,
            // The store's own object. The host is a different bundle reading it,
            // never writing it — and cloning a whole module per burst is the cost
            // this debounce exists to avoid paying more than once.
            source,
          },
        }),
      );
    };

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
  return null;
}
