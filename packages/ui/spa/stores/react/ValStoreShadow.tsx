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
 * ## Read-only, on purpose
 *
 * `createValSystem` is called without `writes`, so this system records edits and
 * never sends them. Two systems writing to one linear patch chain would conflict
 * with each other on every keystroke, and each would "resolve" it by re-sending.
 * The engine owns writes until it owns everything.
 *
 * ## Off unless asked for
 *
 * Enabled by `window.__VAL_STORES_SHADOW__` or `?val_stores_shadow=1`. Default
 * off, because a second system means a second `GET /patches` and a second
 * `GET /json` per entry, and no user should pay for an experiment. Off also means
 * `useValSystem()` returns null, which every hook already handles.
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
  const enabled = useMemo(() => shadowEnabled(), []);
  const system = useMemo<System | null>(
    () => (enabled ? createValSystem(client) : null),
    [enabled, client],
  );
  const [received, setReceived] = useState(false);

  useEffect(() => {
    if (system === null || valModules === null) {
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
      system?.dispose();
    };
  }, [system]);

  // Exposed so a browser test can wait for intake rather than sleeping, and can
  // reach the system directly to compare it with the engine. Only ever set when
  // the shadow is explicitly enabled.
  useEffect(() => {
    if (system === null) {
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

  if (system === null) {
    return <>{children}</>;
  }
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

function shadowEnabled(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const flagged = (window as unknown as { __VAL_STORES_SHADOW__?: unknown })
    .__VAL_STORES_SHADOW__;
  if (flagged === true) {
    return true;
  }
  try {
    return (
      new URLSearchParams(window.location.search).get("val_stores_shadow") ===
      "1"
    );
  } catch {
    // A window with no parseable location is not a reason to fail the app.
    return false;
  }
}
