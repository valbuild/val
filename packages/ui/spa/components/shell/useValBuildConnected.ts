import { useEffect, useState } from "react";
import { useClient } from "../ValProvider";

/**
 * Whether this Studio can act on Val Build for the person using it — which is
 * what decides whether Val Build's web components are loaded at all.
 *
 * - `http`: yes. A deployed Studio cannot be open without a session.
 * - `fs`: only if the developer ran `val login`. The server says so
 *   (`/admin/status`, which looks for `.val/pat.json`), and until it has
 *   answered the answer is no. Without a login there is nothing for the
 *   components to show, so the top bar keeps its plain project name rather
 *   than mounting something that explains you are not logged in.
 * - anything else (still loading): no.
 */
export function useValBuildConnected(mode: "http" | "fs" | "unknown"): boolean {
  const client = useClient();
  const [fsConnected, setFsConnected] = useState(false);

  useEffect(() => {
    if (mode !== "fs") {
      return;
    }
    let cancelled = false;
    client("/admin/status", "GET", {})
      .then((res) => {
        if (!cancelled && res.status === 200) {
          setFsConnected(res.json.connected);
        }
      })
      .catch(() => {
        // An older server without the route, or none at all: not connected.
      });
    return () => {
      cancelled = true;
    };
  }, [client, mode]);

  return mode === "http" || (mode === "fs" && fsConnected);
}
