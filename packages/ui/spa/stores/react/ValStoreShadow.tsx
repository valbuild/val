import { useEffect, useMemo, useState, type ReactNode } from "react";
import type {
  PatchId,
  SelectorSource,
  ValModule,
  ValModules,
} from "@valbuild/core";
import type { ValClient } from "@valbuild/shared/internal";
import type { System } from "../createSystem";
import { createValSystem, type UploadSettings } from "./createValSystem";
import { ValSystemProvider } from "./SystemContext";
import { ValStoreProbe } from "./ValStoreProbe";

/**
 * Mount the store system inside the real app, beside the engine.
 *
 * ## Why a shadow mount rather than a replacement
 *
 * The store layer is measured and tested, and until now it had never run against
 * a real project in a real browser — the benchmark generates its own modules and
 * every test builds its own. That is a gap no amount of green tests closes: the
 * one thing neither can produce is a project someone actually wrote.
 *
 * Replacing the engine to find out would mean the whole Studio depends on the new
 * layer before anything has checked it against a single real module. So this
 * mounts BOTH. The engine keeps driving every pixel; the system takes the same
 * modules in and can be read alongside, so its answers can be compared with the
 * engine's on real content.
 *
 * ## This system owns writes now
 *
 * It began as a mirror: the engine wrote, and every patch was copied in here so
 * reads stayed correct. That stopped being tenable the moment `/stat` was wired
 * in, and the reason is worth recording because it is the argument for flipping
 * rather than a consequence of having flipped.
 *
 * With both systems holding the same edit, the two chains have to agree on patch
 * IDENTITY, and they cannot. The engine MERGES consecutive keystrokes into one
 * patch (`canMerge` / `mergePatches`); this system creates one per edit. So the
 * engine's chain has one id where this one has six, and when stat announces the
 * engine's id this system does not recognise it, fetches it, and applies the same
 * edit a second time — harmless for a `replace`, wrong for an array `add`.
 *
 * So: this system writes. `useAddPatch` creates the patch here, which mints the id
 * and issues the `PUT`, and then hands that same id to the engine so the engine
 * applies it LOCALLY for every component still reading from it. One id per edit,
 * one writer, and stat announces ids this system already has.
 *
 * The engine's own `PUT` is disabled — see `ValSyncEngine`'s `writesDisabled`.
 *
 * One behaviour change that follows and is not a bug: a typing session now
 * produces one patch per edit rather than one merged patch, so there are more
 * patches on the server. Patch SETS still group them for review, which is what
 * the review UI shows.
 *
 * Still not routed through here, and therefore still the engine's: the four AI
 * write paths in `hooks/useAI.ts`, which call the engine directly rather than
 * through `useAddPatch`. Named rather than left to be discovered.
 *
 * ## Always on
 *
 * It was behind a flag while it was an experiment. It is not one any more: the
 * engine is being removed when this lands, so a switch to turn the replacement
 * off is a switch nobody would ever want. Always creating it also means the port
 * is exercised by every session rather than by whoever remembered the flag.
 *
 * The cost of always-on is currently close to nothing, which is worth knowing
 * rather than assuming: the second system's `fetchPatches` is driven by
 * `stat:receive`, and nothing in the app calls `receiveStat` yet (openquestions
 * item 8), so no duplicate `GET /patches` happens. `GET /json` is per entry and
 * only on a read that descends into an unfetched one. That changes the day stat
 * gets a real input — at which point the engine's own polling should be the thing
 * that goes, not this.
 */
export function ValStoreShadow({
  client,
  valModules,
  stat,
  uploadSettings,
  children,
}: {
  client: ValClient;
  valModules: ValModules | null;
  /**
   * What `/stat` last said. The store system needs two things out of it and
   * cannot work without either: the ordered patch ids (so it learns about work
   * done in another session) and `baseSha` (so a write has an honest `parentRef`
   * — without it `PatchSync` reports every edit unsaveable).
   */
  stat: { baseSha: string; patches: PatchId[] } | null;
  uploadSettings: UploadSettings;
  children: ReactNode;
}) {
  const system = useMemo<System>(
    () => createValSystem(client, { writes: true, uploadSettings }),
    [client, uploadSettings],
  );
  const [received, setReceived] = useState(false);

  useEffect(() => {
    if (valModules === null) {
      return;
    }
    let cancelled = false;
    void (async () => {
      // The defs are async thunks (`() => import("./x.val")`), so intake has to
      // await them — the same reason `ValSyncEngine.setValModules` is async. One
      // failed module must not lose the rest, so each is settled separately.
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
      if (modules.length > 0) {
        system.host.receive(modules);
        setReceived(true);
      }
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
    system.stat.receiveStat({ patches: stat.patches, baseSha: stat.baseSha });
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

  // Exposed so a browser test can wait for intake rather than sleeping, and can
  // reach the system directly to compare it with the engine's answers.
  useEffect(() => {
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
      <ValStoreProbe />
      {children}
    </ValSystemProvider>
  );
}
