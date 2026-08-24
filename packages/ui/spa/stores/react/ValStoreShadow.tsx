import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { SelectorSource, ValModule, ValModules } from "@valbuild/core";
import type { ValClient } from "@valbuild/shared/internal";
import type { System } from "../createSystem";
import { createValSystem } from "./createValSystem";
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
 * ## A mirror, not a second writer
 *
 * `createValSystem` is called without `writes`, so this system never sends a patch
 * to the server. Two systems writing to one linear patch chain would conflict with
 * each other on every keystroke, and each would "resolve" it by re-sending. The
 * engine owns writes until it owns everything.
 *
 * But it does have to SEE the engine's edits, or its source drifts from what the
 * screen shows the moment anyone types — and then a component ported to read from
 * it would show a stale value. So `useAddPatch` mirrors every field write into
 * this system's patch store (see `ValFieldProvider`), and `mirror: true` gives it
 * an upload seam that accepts file patches without re-uploading bytes the engine
 * has already sent.
 *
 * What is NOT mirrored, and therefore where the shadow can legitimately diverge:
 * the AI write paths in `hooks/useAI.ts`, which call the engine directly rather
 * than through `useAddPatch`. Named here rather than discovered later.
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
  children,
}: {
  client: ValClient;
  valModules: ValModules | null;
  children: ReactNode;
}) {
  const system = useMemo<System>(
    () => createValSystem(client, { mirror: true }),
    [client],
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

  useEffect(() => {
    return () => {
      system.dispose();
    };
  }, [system]);

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
