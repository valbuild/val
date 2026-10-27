import { useEffect, useState } from "react";
import { useClient } from "../ValProvider";

export type ValBuildAccess = {
  /** Whether Val Build's web components are loaded at all. */
  connected: boolean;
  /**
   * The components' `mode`: how an editor signs in again when Val Build says
   * the session is gone. `fs` is `val login`, on a developer's own checkout;
   * `http` is the Studio's sign-in. Absent until it is known.
   */
  studioMode?: "fs" | "http";
};

/**
 * Whether this Studio can act on Val Build for the person using it, and how
 * they sign in to it.
 *
 * Neither is the Studio's stat `mode`. That answers whether patches are kept
 * locally, and a deployed memory-mode host answers `fs` — so reading it as
 * "local development" told editors of those hosts to run `val login`, in a
 * place with no working directory to run it in. The server knows which it
 * is, and `/admin/status` says (`signIn`).
 *
 * - stat `http`: connected, signing in through the Studio. Nothing to ask.
 * - stat `fs`: ask `/admin/status`. On a developer's checkout the components
 *   load only after `val login` — without one there is nothing to show, so
 *   the Studio stays as it was rather than mounting something that says you
 *   are not logged in. On a deployed host signing in through the Studio, they
 *   load as they do in http mode, and ask for the Studio's sign-in.
 * - anything else (still loading): not connected.
 */
export function useValBuildAccess(
  mode: "http" | "fs" | "unknown",
): ValBuildAccess {
  const client = useClient();
  const [status, setStatus] = useState<ValBuildAccess>({ connected: false });

  useEffect(() => {
    if (mode !== "fs") {
      return;
    }
    let cancelled = false;
    client("/admin/status", "GET", {})
      .then((res) => {
        if (cancelled || res.status !== 200) {
          return;
        }
        // An older server sends no `signIn`; it only ran locally in fs mode.
        const studio = res.json.signIn === "studio";
        setStatus({
          connected: res.json.connected || studio,
          studioMode: studio ? "http" : "fs",
        });
      })
      .catch(() => {
        // An older server without the route, or none at all: not connected.
      });
    return () => {
      cancelled = true;
    };
  }, [client, mode]);

  if (mode === "http") {
    return { connected: true, studioMode: "http" };
  }
  if (mode === "fs") {
    return status;
  }
  return { connected: false };
}
