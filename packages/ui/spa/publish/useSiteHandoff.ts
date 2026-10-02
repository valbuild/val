import { useCallback, useRef, useState } from "react";
import type { PublishTabJob } from "@valbuild/shared/internal";
import type { HandoffState } from "../components/shell/PublishHandoff";
import {
  canBuildHere,
  openBuilderWindow,
  openHandoff,
  type SiteHandoff,
} from "./handoff";
import { RENEW_EVERY_MS, type StudioJobResult } from "./runStudioJob";

/**
 * How long a refused renewal waits for the tab's own report. See `runJob`.
 */
export const LOST_GRACE_MS = 3_000;

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
  prepare: (buildsInTab: boolean) => void;
  /** Is a handoff waiting for a job? Then the job must not build here. */
  active: () => boolean;
  /**
   * Hand the tab the job to run, as this page's tab `tab`. Resolves with the
   * tab's part of it -- handed to content, lost or failed -- or `lost` when
   * the handoff is cancelled or dismissed first.
   *
   * The lease is renewed from here while the tab is not running it yet: a
   * blocked tab waits for the press on "Open the Studio to publish", and the
   * job must still be this page's when it does. A renewal answered `false`
   * means it no longer is -- the lease lapsed, and its requests went back to
   * the queue -- so the wait ends as `lost` rather than for a tab that will
   * never report. A renewal that did not get through is not an answer.
   */
  runJob: (
    job: PublishTabJob,
    tab: string,
    requestId: string | null,
    renew: () => Promise<boolean>,
  ) => Promise<StudioJobResult>;
  /** The publish did not happen: the tab has nothing to build. */
  cancel: (message: string) => void;
  dismiss: () => void;
  /** Open (or re-open) the tab that builds it: for a blocked or failed one. */
  openStudio: () => void;
}

export function useSiteHandoff(
  options: {
    /** See `handsOffPublish` on `ValProvider`: the overlay's alone. */
    enabled?: boolean;
  } = {},
): UseSiteHandoff {
  const [state, setState] = useState<HandoffState | null>(null);
  const current = useRef<SiteHandoff | null>(null);
  /** The job handed to the tab, and who is waiting for the tab's part of it. */
  const waiting = useRef<{
    jobId: string;
    resolve: (result: StudioJobResult) => void;
    stop: () => void;
  } | null>(null);

  const settleWaiting = useCallback((result: StudioJobResult | "lost") => {
    const w = waiting.current;
    if (w === null) return;
    waiting.current = null;
    w.stop();
    w.resolve(result === "lost" ? { status: "lost", jobId: w.jobId } : result);
  }, []);

  const enabled = options.enabled ?? false;
  const prepare = useCallback(
    (buildsInTab: boolean) => {
      if (!enabled || !buildsInTab || canBuildHere()) return;
      current.current?.close();
      settleWaiting("lost");
      const handoff = openHandoff();
      current.current = handoff;
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
        } else if (message.type === "job-result") {
          if (waiting.current?.jobId === message.result.jobId) {
            settleWaiting(message.result);
          }
        } else if (message.type === "done") {
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
          settleWaiting("lost");
          handoff.close();
          current.current = null;
        }
      });
    },
    [enabled, settleWaiting],
  );

  const active = useCallback(() => current.current !== null, []);

  const runJob = useCallback<UseSiteHandoff["runJob"]>(
    (job, tab, requestId, renew) => {
      const handoff = current.current;
      if (handoff === null) {
        return Promise.resolve({ status: "lost", jobId: job.id });
      }
      settleWaiting("lost");
      return new Promise<StudioJobResult>((resolve) => {
        let grace: ReturnType<typeof setTimeout> | null = null;
        const renewing = setInterval(() => {
          renew().then(
            (renewed) => {
              if (renewed || grace !== null) return;
              /*
               * Not this page's any more. A tab that just handed the job to
               * content also stops holding it, and its `job-result` may be a
               * moment behind the renewal that says so -- so it gets that
               * moment before the wait ends as lost.
               */
              grace = setTimeout(() => {
                if (waiting.current?.jobId === job.id) settleWaiting("lost");
              }, LOST_GRACE_MS);
            },
            () => {},
          );
        }, RENEW_EVERY_MS);
        waiting.current = {
          jobId: job.id,
          resolve,
          stop: () => {
            clearInterval(renewing);
            if (grace !== null) clearTimeout(grace);
          },
        };
        handoff.job({ type: "job", job, tab, requestId });
      });
    },
    [settleWaiting],
  );

  const cancel = useCallback(
    (message: string) => {
      current.current?.cancel(message);
      current.current?.close();
      current.current = null;
      settleWaiting("lost");
      setState(null);
    },
    [settleWaiting],
  );

  const dismiss = useCallback(() => {
    // A dismissed card is a handoff given up: the job's lease lapses, and
    // its requests go back to the queue for a tab that can build.
    current.current?.close();
    current.current = null;
    settleWaiting("lost");
    setState(null);
  }, [settleWaiting]);

  const openStudio = useCallback(() => {
    const handoff = current.current;
    if (handoff !== null) {
      // The same id, so the tab finds the job this page is holding.
      const opened =
        openBuilderWindow(handoff.url, `val-publish-${handoff.id}`) !== null;
      // Blocked again: keep offering the button rather than claiming it opened.
      if (opened) setState({ kind: "opening" });
      return;
    }
    window.open("/val", "_blank");
  }, []);

  return { state, prepare, active, runJob, cancel, dismiss, openStudio };
}
