import { useEffect, useState, type ReactNode } from "react";
import type {
  PatchId,
  SelectorSource,
  ValModule,
  ValModules,
} from "@valbuild/core";
import type { System } from "../createSystem";
import { ValSystemProvider } from "./SystemContext";
import { ValStoreProbe } from "./ValStoreProbe";

/**
 * Put the store system in context, take the project in, and feed it `/stat`.
 *
 * ## What it does NOT do: build the system
 *
 * The system is created by `ValProvider` and passed in. It reads as an
 * indirection and is not: `ValProvider`'s own body needs to read the stores —
 * for the unsaved-edit count, for publish and discard, for the error surfaces —
 * and a system created HERE is created below the component that has to use it.
 * Everything long-lived in the Studio is built in `ValProvider`; this is not the
 * exception.
 *
 * ## Where the data comes from
 *
 * Two inputs, and they arrive by very different routes.
 *
 * **Modules** come from the host app as a React prop. The app imports its own
 * `val.modules`, so schema and committed source are already in this process and
 * `host.receive` derives both — no round trip, and nothing to retry. This is why
 * the ~100 lines of init state machine that used to live in `ValProvider` are
 * gone rather than moved.
 *
 * **The patch chain** is genuinely remote, and `/stat` is how it arrives:
 * `StatStore` is told the ordered ids and `PatchStore` fetches only the ones it
 * does not already have. That is also how a second editor's work reaches this
 * one.
 */
export function ValStoreProvider({
  system,
  valModules,
  stat,
  children,
}: {
  /** Built by `ValProvider`. See the note above on why it is not built here. */
  system: System;
  valModules: ValModules | null;
  /**
   * What `/stat` last said. The store system needs two things out of it and
   * cannot work without either: the ordered patch ids (so it learns about work
   * done in another session) and `baseSha` (so a write has an honest `parentRef`
   * — without it `PatchSync` reports every edit unsaveable).
   */
  stat: {
    baseSha: string;
    patches: PatchId[];
    /** See {@link StatSnapshot.removed}. Cleared by the next stat. */
    removed?: { patchId: PatchId; reason: string }[];
  } | null;
  children: ReactNode;
}) {
  const [received, setReceived] = useState(false);

  useEffect(() => {
    if (valModules === null) {
      return;
    }
    let cancelled = false;
    void (async () => {
      // The defs are async thunks (`() => import("./x.val")`), so intake has to
      // await them. One failed module must not lose the rest, so each is
      // settled separately — and `HostStore.receive` records the ones that fail
      // to serialize rather than throwing, for the same reason.
      const settled = await Promise.allSettled(
        valModules.modules.map((entry) => entry.def()),
      );
      if (cancelled) {
        return;
      }
      const modules: ValModule<SelectorSource>[] = [];
      for (const result of settled) {
        if (result.status === "fulfilled") {
          modules.push(result.value.default);
        }
      }
      /**
       * Unconditionally, even when NOTHING was adopted.
       *
       * The guard here used to be `modules.length > 0`, which reads as caution
       * and is a hang: if every import rejects — or the registry is momentarily
       * empty — `receivedAt` stays null, so every readiness gate reads "not
       * ready", `/stat` is never fed in, and anything waiting on intake waits
       * forever. `receive([])` completes intake honestly: no modules, and the
       * project is known to have none rather than not yet known.
       *
       * The failures are not lost: `HostStore.receive` records the ones that
       * could not serialize and the dev banner names them.
       */
      system.host.receive(modules);
      setReceived(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [system, valModules]);

  /**
   * Feed `/stat` in, once the modules are here.
   *
   * After intake, deliberately: `receiveStat` announces patch ids, and the patch
   * store fetches and applies the ones it does not have. Applying them before the
   * modules exist is not wrong — the chain is kept and replayed by `receive` — but
   * doing it in the natural order means the common case does not depend on that.
   *
   * `baseSha` is the part that unblocks writing. Everything else the store needs
   * from stat it already gets: `schemaSha` / `sourcesSha` / `jsonEntriesSha` are
   * inputs to a refetch this system does not do yet, and are the remaining half of
   * openquestions item 8.
   */
  useEffect(() => {
    if (stat === null || !received) {
      return;
    }
    system.stat.receiveStat({
      patches: stat.patches,
      baseSha: stat.baseSha,
      removed: stat.removed,
    });
  }, [system, stat, received]);

  /*
   * There is deliberately NO dispose effect, and this is the most expensive thing
   * learned from running the system in the real Studio.
   *
   * There was one — `useEffect(() => () => system.dispose(), [system])` — and it
   * broke the system completely, silently, in dev. `React.StrictMode` (see
   * `main.jsx`) mounts effects twice: mount, cleanup, mount. The cleanup ran
   * `dispose()`, which runs every unsubscribe in `createSystem` — and those
   * listeners are attached at CONSTRUCTION, not in the effect, so nothing
   * re-attached them on the second mount. The result was a system that took
   * modules in and then ignored everything: stat announced and nothing heard it,
   * a patch created and never applied to source. Both symptoms, one cause.
   *
   * Nothing needs disposing here. The system is memoised on `client`, so there is
   * exactly one and it lives as long as the provider; and when it does become
   * unreachable, its stores' listeners point only at each other, so the whole
   * graph is collected together. `dispose()` exists for tests, which create and
   * discard systems in one process.
   *
   * The general shape of the mistake is worth keeping: a cleanup that tears down
   * something built outside the effect is not symmetric, and React is allowed to
   * run cleanups on a component that stays mounted.
   */

  /**
   * Exposed so a browser test can wait for intake rather than sleeping, and can
   * drive the system directly. See `e2e/studio.spec.ts`.
   *
   * NOT in a production build. `System` carries write, publish and discard, so
   * this is a mutation surface, and putting it on `window` hands it to every
   * script on the page — in an app whose whole point is that its content is
   * editable by authorised people only. Gated on `NODE_ENV` rather than on Val's
   * own `fs`/`http` mode because the bundler can then remove it outright, and
   * because it is the same gate a reader will expect.
   */
  useEffect(() => {
    if (process.env.NODE_ENV === "production") {
      return;
    }
    const bag = window as unknown as {
      __VAL_STORES__?: { system: System; received: boolean };
    };
    bag.__VAL_STORES__ = { system, received };
    return () => {
      delete bag.__VAL_STORES__;
    };
  }, [system, received]);

  return (
    <ValSystemProvider system={system}>
      {/*
        A field rendered through the hooks, invisible, driven from outside. The
        shadow mount shows the SYSTEM takes real modules; this shows a COMPONENT
        can get a value out of it. Only ever mounted when the shadow is on.
      */}
      {process.env.NODE_ENV !== "production" && <ValStoreProbe />}
      {children}
    </ValSystemProvider>
  );
}
