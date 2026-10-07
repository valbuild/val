import { useCallback, useRef, useState } from "react";
import type {
  PublishRequestStatus,
  PublishTabJob,
} from "@valbuild/shared/internal";
import type { HandoffState } from "../components/shell/PublishHandoff";
import {
  canBuildHere,
  openBuilderWindow,
  openHandoff,
  type HandoffIntent,
  type SiteHandoff,
  type ToSite,
} from "./handoff";
import { RENEW_EVERY_MS, type StudioJobResult } from "./runStudioJob";
import { randomUUID } from "../utils/randomUUID";
import { PUBLISH_TAB_ID } from "./tabId";

/** What the builder tab pressed for this page. See `ToSite`. */
export type HandoffPressed = Extract<ToSite, { type: "pressed" }>;

/**
 * How long a refused renewal waits for the tab's own report. See `runJob`.
 */
export const LOST_GRACE_MS = 3_000;

/**
 * How long a tab may be silent before this page stops waiting for it.
 *
 * A tab says it is `alive` every 2 s for as long as it is open, so this is
 * many missed beats, not a slow step. Until its first word it gets longer:
 * that is the Studio loading, which on a phone is seconds of download.
 */
export const TAB_SILENT_MS = 20_000;
export const TAB_FIRST_WORD_MS = 90_000;
const WATCH_EVERY_MS = 2_000;

/** What the card says when the tab stopped answering. */
export const TAB_GONE_MESSAGE =
  "The Studio tab stopped answering: it was closed, or the phone paused it in the background. Nothing is lost -- press Publish to try again.";

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
   *
   * `true` when it opened (or tried to open) a builder tab: the TAB presses,
   * as this page, under a request id minted here -- this page must not press
   * as well. It hears what was pressed through `onPressed`. `tryAgainOf`
   * makes the press a try again of that failed request.
   */
  prepare: (buildsInTab: boolean, options?: { tryAgainOf?: string }) => boolean;
  /**
   * Is a handoff under way? Its tab presses for this page, and builds any job
   * this page is handed meanwhile -- so neither happens here.
   */
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
    /**
     * Let the job go now, when the tab stopped answering while it still had
     * it -- cancelled before the seal, so the next press starts a fresh job
     * at once rather than joining one nobody is building. Only called while
     * a renewal says the job is still this page's at a tab step: a job the
     * tab handed to content just before it went quiet is never touched.
     */
    release?: () => Promise<boolean>,
  ) => Promise<StudioJobResult>;
  /**
   * A publish this page follows has settled. After the tab hands its job to
   * content it closes, and the card's last word -- Live, or why not -- comes
   * from this page's own tracker, through here. Ignored for any other request.
   */
  settled: (requestId: string, status: PublishRequestStatus) => void;
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
    /**
     * The builder tab pressed for this page: follow the request as one of
     * this page's own. It arrives whenever the page is in front again -- on
     * an iPhone, not before the editor goes back to it.
     */
    onPressed?: (pressed: HandoffPressed) => void;
  } = {},
): UseSiteHandoff {
  const onPressed = useRef(options.onPressed);
  onPressed.current = options.onPressed;
  const [state, setState] = useState<HandoffState | null>(null);
  const current = useRef<SiteHandoff | null>(null);
  /** When the press that opened the tab was, for the card's "Live after". */
  const startedAt = useRef<number | null>(null);
  /**
   * The request whose job the tab handed to content, and this page now
   * follows to the end (`null`: whichever settles next, for a press this page
   * could not name).
   */
  const following = useRef<{ requestId: string | null } | null>(null);
  /** The request the job being run was pressed for. See `runJob`. */
  const pressedFor = useRef<string | null>(null);
  /**
   * When the tab last said anything, and whether it ever has. A tab that goes
   * quiet is gone -- closed, or suspended by a phone -- and a page that
   * waited for it for ever held the job, and the Publish button, with it: the
   * card at "running" has nothing to dismiss, so the editor was stuck until
   * they reloaded. See {@link TAB_SILENT_MS}.
   */
  const heard = useRef<{ at: number; any: boolean }>({ at: 0, any: false });
  /** The browser refused the tab: waiting on the editor's press, not on a tab. */
  const blocked = useRef(false);
  const watchdog = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopWatching = useCallback(() => {
    if (watchdog.current !== null) clearInterval(watchdog.current);
    watchdog.current = null;
  }, []);
  /** The job handed to the tab, and who is waiting for the tab's part of it. */
  const waiting = useRef<{
    jobId: string;
    resolve: (result: StudioJobResult) => void;
    stop: () => void;
    renew: () => Promise<boolean>;
    release?: () => Promise<boolean>;
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
    (buildsInTab: boolean, prepareOptions?: { tryAgainOf?: string }) => {
      if (!enabled || !buildsInTab || canBuildHere()) return false;
      current.current?.close();
      settleWaiting("lost");
      following.current = null;
      startedAt.current = Date.now();
      /*
       * Named here, in the tap, and pressed by the tab: see `handoff.ts`.
       * This page's tab, so the job is leased to the tab content expects and
       * this page's own runner can still hand the tab a job it took.
       */
      const requestId = randomUUID();
      pressedFor.current = requestId;
      const intent: HandoffIntent =
        prepareOptions?.tryAgainOf !== undefined
          ? {
              kind: "try-again",
              requestId,
              tab: PUBLISH_TAB_ID,
              replaces: prepareOptions.tryAgainOf,
            }
          : { kind: "press", requestId, tab: PUBLISH_TAB_ID };
      const handoff = openHandoff({ intent });
      current.current = handoff;
      blocked.current = !handoff.opened;
      setState(blocked.current ? { kind: "blocked" } : { kind: "opening" });
      heard.current = { at: Date.now(), any: false };
      /*
       * The page's own pauses are not the tab's silence: a phone suspends the
       * page while the editor is in the builder tab, and the tab's messages
       * arrive after the page's timers when it resumes. Judged from when the
       * page was last in front, too.
       */
      let resumedAt = Date.now();
      const onVisible = () => {
        if (document.visibilityState === "visible") resumedAt = Date.now();
      };
      document.addEventListener("visibilitychange", onVisible);
      stopWatching();
      const gone = () => {
        stopWatching();
        document.removeEventListener("visibilitychange", onVisible);
        if (current.current !== handoff) return;
        /*
         * Stop holding the job: the renewals end with the wait, its lease
         * lapses, and the next press -- here, or anywhere -- takes it up. The
         * request is still followed, for a tab that handed it to content just
         * before it went quiet: a Live after this replaces the card.
         */
        const w = waiting.current;
        following.current =
          w !== null ? { requestId: pressedFor.current } : null;
        if (w?.release) {
          const release = w.release;
          void (async () => {
            const stillOurs = await w.renew().catch(() => false);
            if (!stillOurs) return;
            /*
             * Cancelled, so it settles as such: nothing to follow, and the
             * card keeps saying why rather than being cleared by it.
             */
            if (await release().catch(() => false)) following.current = null;
          })();
        }
        settleWaiting("lost");
        handoff.close();
        current.current = null;
        setState({ kind: "failed", message: TAB_GONE_MESSAGE });
      };
      watchdog.current = setInterval(() => {
        if (current.current !== handoff) {
          stopWatching();
          document.removeEventListener("visibilitychange", onVisible);
          return;
        }
        // Waiting on the editor's press, not on a tab.
        if (blocked.current || document.visibilityState === "hidden") return;
        const silentFor = Date.now() - Math.max(heard.current.at, resumedAt);
        if (
          silentFor > (heard.current.any ? TAB_SILENT_MS : TAB_FIRST_WORD_MS)
        ) {
          gone();
        }
      }, WATCH_EVERY_MS);
      handoff.onMessage((message) => {
        if (current.current !== handoff) return;
        heard.current = { at: Date.now(), any: true };
        blocked.current = false;
        if (message.type === "ready") {
          setState((prev) =>
            prev?.kind === "blocked" ? { kind: "opening" } : prev,
          );
        } else if (message.type === "pressed") {
          pressedFor.current = message.requestId;
          onPressed.current?.(message);
          if (message.building) return;
          /*
           * It joined a job already in flight, or settled at once: the tab has
           * nothing to build, and says why itself. This page's tracker follows
           * the request; the card has nothing left to say.
           */
          stopWatching();
          handoff.close();
          current.current = null;
          setState(null);
        } else if (message.type === "phase") {
          setState({
            kind: "running",
            step: message.label,
            elapsedMs: message.elapsedMs,
            ...(message.percent !== undefined
              ? { percent: message.percent }
              : {}),
          });
        } else if (message.type === "job-result") {
          /*
           * The job this page handed over, or -- with nothing handed over --
           * the one the tab's own press started.
           */
          if (
            waiting.current !== null &&
            waiting.current.jobId !== message.result.jobId
          )
            return;
          settleWaiting(message.result);
          if (message.result.status !== "handed-off") return;
          /*
           * Content has the build, and checks it and puts it live without the
           * tab, which closes now. The rest is this page's to follow.
           */
          following.current = { requestId: pressedFor.current };
          setState({ kind: "checking" });
          stopWatching();
          handoff.close();
          current.current = null;
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
          stopWatching();
          handoff.close();
          current.current = null;
        }
      });
      return true;
    },
    [enabled, settleWaiting, stopWatching],
  );

  const active = useCallback(() => current.current !== null, []);

  const runJob = useCallback<UseSiteHandoff["runJob"]>(
    (job, tab, requestId, renew, release) => {
      const handoff = current.current;
      if (handoff === null) {
        return Promise.resolve({ status: "lost", jobId: job.id });
      }
      settleWaiting("lost");
      pressedFor.current = requestId;
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
          renew,
          ...(release !== undefined ? { release } : {}),
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

  const settled = useCallback<UseSiteHandoff["settled"]>(
    (requestId, status) => {
      const followed = following.current;
      if (followed === null) return;
      if (followed.requestId !== null && followed.requestId !== requestId)
        return;
      following.current = null;
      if (status.kind === "live" || status.kind === "nothing-to-publish") {
        setState({
          kind: "live",
          ms: Date.now() - (startedAt.current ?? Date.now()),
          followed: true,
        });
      } else if (status.kind === "failed") {
        setState({
          kind: "failed",
          message: status.message,
          followed: true,
        });
      } else {
        setState(null);
      }
    },
    [],
  );

  const cancel = useCallback(
    (message: string) => {
      stopWatching();
      current.current?.cancel(message);
      current.current?.close();
      current.current = null;
      settleWaiting("lost");
      setState(null);
    },
    [settleWaiting, stopWatching],
  );

  const dismiss = useCallback(() => {
    // A dismissed card is a handoff given up: the job's lease lapses, and
    // its requests go back to the queue for a tab that can build.
    stopWatching();
    following.current = null;
    current.current?.close();
    current.current = null;
    settleWaiting("lost");
    setState(null);
  }, [settleWaiting, stopWatching]);

  const openStudio = useCallback(() => {
    const handoff = current.current;
    if (handoff !== null) {
      // The same URL: the tab presses what it names, and finds this page by its id.
      const opened =
        openBuilderWindow(handoff.url, `val-publish-${handoff.id}`) !== null;
      // Blocked again: keep offering the button rather than claiming it opened.
      if (opened) {
        blocked.current = false;
        heard.current = { at: Date.now(), any: false };
        setState({ kind: "opening" });
      }
      return;
    }
    window.open("/val", "_blank");
  }, []);

  return {
    state,
    prepare,
    active,
    runJob,
    settled,
    cancel,
    dismiss,
    openStudio,
  };
}
