import { useCallback, useRef, useState } from "react";
import type { HandoffState } from "../components/shell/PublishHandoff";
import {
  canBuildHere,
  openHandoff,
  type SiteHandoff,
  type ToTab,
} from "./handoff";

/**
 * The site's side of a publish handed to a Studio tab. See `handoff.ts`.
 *
 * One per provider, like the deploy, so the button that starts it and the card
 * that reports on it read the same state.
 */
export interface UseSiteHandoff {
  /** What the card says, or `null` for no card. */
  state: HandoffState | null;
  /**
   * Call in the PRESS that starts a publish, before anything awaits: that is
   * the only moment the browser lets a tab open. A no-op where the page can
   * build, and for a project the Studio does not deploy.
   */
  prepare: (studioIsDeployer: boolean) => void;
  /** Is a handoff waiting for a commit? Then the save must not build here. */
  active: () => boolean;
  commit: (payload: Omit<Extract<ToTab, { type: "commit" }>, "type">) => void;
  /** The publish did not happen: the tab has nothing to build. */
  cancel: (message: string) => void;
  dismiss: () => void;
  /** Open (or re-open) the tab that builds it: for a blocked or failed one. */
  openStudio: () => void;
}

export function useSiteHandoff(
  options: {
    /**
     * The tab published `commit` and it is live: the site is serving it, the
     * same as `/stat` reporting it would say.
     */
    onLive?: (commit: string) => void;
    /** See `handsOffPublish` on `ValProvider`: the overlay's alone. */
    enabled?: boolean;
  } = {},
): UseSiteHandoff {
  const [state, setState] = useState<HandoffState | null>(null);
  const current = useRef<SiteHandoff | null>(null);
  /** The commit handed to the tab, which the tab's `done` is about. */
  const committed = useRef<string | null>(null);
  const onLive = useRef(options.onLive);
  onLive.current = options.onLive;

  const enabled = options.enabled ?? false;
  const prepare = useCallback(
    (studioIsDeployer: boolean) => {
      if (!enabled || !studioIsDeployer || canBuildHere()) return;
      current.current?.close();
      const handoff = openHandoff();
      current.current = handoff;
      committed.current = null;
      setState(handoff.opened ? { kind: "opening" } : { kind: "blocked" });
      handoff.onMessage((message) => {
        if (current.current !== handoff) return;
        if (message.type === "ready") {
          setState((prev) =>
            prev?.kind === "blocked" ? { kind: "opening" } : prev,
          );
        } else if (message.type === "phase") {
          setState({
            kind: "running",
            step: message.label,
            elapsedMs: message.elapsedMs,
          });
        } else {
          setState(
            message.result.status === "failed"
              ? {
                  kind: "failed",
                  message:
                    message.summary ??
                    "The site could not be rebuilt. Publish again to retry.",
                  details: message.result.message,
                }
              : { kind: "live", ms: message.ms },
          );
          if (
            message.result.status !== "failed" &&
            committed.current !== null
          ) {
            onLive.current?.(committed.current);
          }
          handoff.close();
          current.current = null;
        }
      });
    },
    [enabled],
  );

  const active = useCallback(() => current.current !== null, []);

  const commit = useCallback<UseSiteHandoff["commit"]>((payload) => {
    committed.current = payload.commit;
    current.current?.commit({ type: "commit", ...payload });
  }, []);

  const cancel = useCallback((message: string) => {
    current.current?.cancel(message);
    current.current?.close();
    current.current = null;
    setState(null);
  }, []);

  const dismiss = useCallback(() => {
    setState(null);
  }, []);

  const openStudio = useCallback(() => {
    const handoff = current.current;
    if (handoff !== null) {
      // The same id, so the tab finds the commit this page is holding.
      window.open(handoff.url, `val-publish-${handoff.id}`);
      setState({ kind: "opening" });
      return;
    }
    window.open("/val", "_blank");
  }, []);

  return { state, prepare, active, commit, cancel, dismiss, openStudio };
}
