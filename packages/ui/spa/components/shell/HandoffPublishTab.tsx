import { useEffect, useRef, useState } from "react";
import { useStudioDeployState } from "../ValProvider";
import {
  joinHandoff,
  leaveTo,
  INTENT_MAX_AGE_MS,
  storedHandoffIntent,
  type HandoffIntent,
  type TabHandoff,
} from "../../publish/handoff";
import {
  CHANGE_NOT_SAVED_MESSAGE,
  askServerAbout,
  hasChange,
  followRequest,
  NOT_LOADED_MESSAGE,
  type PressIntent,
  pressBuilds,
  pressedAlready,
  pressForPage,
  rememberedEnding,
  rememberEnding,
  settledMessage,
  waitForChange,
  whenReady,
} from "../../publish/pressForPage";
import { useValSystem } from "../../stores/react/SystemContext";
import {
  deployPercent,
  describeDeployPhase,
  describeDeployStep,
} from "../../publish/deployProgress";
import type { DeployPhase } from "../../publish/runStudioDeploy";
import {
  deployPreparedJob,
  type StudioDeployState,
} from "../../publish/useStudioDeploy";
import { createStudioPublishClient } from "../../publish/publishClient";
import { createStudioJobClient } from "../../publish/jobClient";
import { runJobToEnd, runStudioJob } from "../../publish/runStudioJob";
import { isSettled } from "../../publish/publishJobs";
import type {
  PublishRequestStatus,
  PublishTabJob,
} from "@valbuild/shared/internal";
import {
  runSiteUpdate,
  type SiteUpdateOutcome,
} from "../../publish/runSiteUpdate";
import {
  StudioPublishPage,
  type PublishPageResult,
  type PublishStep,
} from "./PublishHandoff";

/**
 * The Studio tab a page that cannot build opened to publish from it.
 *
 * It presses Publish FOR the page -- the gate, then content's press, as the
 * site's tab and under the request id the page minted (its URL says so: see
 * `HandoffIntent`) -- because the page may be paused from the moment this tab
 * took the screen. It runs the job AS THE SITE'S TAB -- the job is leased to
 * the tab that pressed -- with the same `runStudioJob` a Studio runs its own
 * jobs with, and reports each step back to the page. Its work ends at the
 * upload: content checks the site renders and puts it live on its own, and the
 * page that opened this follows that itself -- so this closes, rather than
 * being kept open for a check it plays no part in.
 *
 * A page that is awake may still hand it a job over the channel -- queued
 * work it took -- and this builds that the same way.
 *
 * Opened again -- reloaded, gone back to, the URL reopened -- it shows the
 * publish it was opened for and never makes it a second time: it asks content
 * where that request is first, and follows it if it was made (taking its
 * build up again if a reload cut it short), and what content cannot say --
 * a press the gate refused, an update -- it remembers itself.
 */

const ORDER: DeployPhase["kind"][] = [
  "getting-ready",
  "reading",
  "building",
  "declaring",
  "uploading",
  "confirming",
  "verifying",
  "promoting",
];

/**
 * How long a tab with no stored intent waits to be told what to do over the
 * channel, as a page from before intents tells it. Short: the usual reason is
 * a link from somewhere else, or one so old its intent was forgotten -- and
 * either way this tab must not start anything. A job that arrives after this
 * still runs: only a page of this origin can send one.
 */
const NO_INTENT_TIMEOUT_MS = 15_000;
const NO_INTENT_MESSAGE =
  "This tab has no publish to run: it was not opened by pressing Publish in this browser, or that was too long ago. Nothing was published.";
const STALE_MESSAGE =
  "This publish was started over an hour ago and never ran, so nothing was published. Publish again to publish your changes.";

/**
 * What the tab shows when another publish took the page's change before this
 * tab could press: Live. Shown here and never sent anywhere, so it names no
 * commit.
 */
const SHIPPED_ELSEWHERE: PublishRequestStatus = { kind: "live", commit: "" };

/** Seconds a finished tab stays up before closing itself. */
const CLOSE_AFTER_S = 5;

/**
 * How long a failed run waits for content's own account of the failure: the
 * request's message, which is what the Studio's toast says.
 */
const FAILURE_READS = 5;
const FAILURE_READ_MS = 1_000;

type Waiting =
  | { kind: "waiting"; since: number }
  /** Following a press already made, until it settles or has a job here. */
  | { kind: "following"; since: number; label: string }
  | { kind: "started"; waitedMs: number; jobId: string | null }
  | { kind: "cancelled"; message: string; details?: string };

/** How this tab's part ended. */
type GoingLive =
  | { kind: "handed-off" }
  | { kind: "failed"; message: string; details?: string };

export function HandoffPublishTab({ id }: { id: string }) {
  const { state, deploy } = useStudioDeployState();
  const val = useValSystem();
  /** Read by the press, which outlives the render it started in. */
  const valRef = useRef(val);
  valRef.current = val;
  /*
   * What this tab is to do, as the tap that opened it stored it -- never from
   * the URL, which anyone can send (see `handoff.ts`). Read once, like the
   * hand-off's id: the tab is for this one press. `stale`: too old to start
   * anything, only to show what it did.
   */
  const [{ intent, stale }] = useState<{
    intent: HandoffIntent | null;
    stale: boolean;
  }>(() => {
    const stored =
      typeof window === "undefined" ? null : storedHandoffIntent(id);
    return {
      intent: stored?.intent ?? null,
      stale: stored !== null && Date.now() - stored.at > INTENT_MAX_AGE_MS,
    };
  });
  /** How this tab ended the last time it was open, if content cannot say. */
  const [remembered] = useState(() =>
    intent === null ? null : rememberedEnding(id),
  );
  const [waiting, setWaiting] = useState<Waiting>(() =>
    remembered?.kind === "not-pressed"
      ? {
          kind: "cancelled",
          message: remembered.message,
          ...(remembered.details !== undefined
            ? { details: remembered.details }
            : {}),
        }
      : { kind: "waiting", since: Date.now() },
  );
  /** The request, settled, when this tab followed it rather than built it. */
  const [settled, setSettled] = useState<PublishRequestStatus | null>(null);
  const [goingLive, setGoingLive] = useState<GoingLive | null>(null);
  const [closingIn, setClosingIn] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const tab = useRef<TabHandoff | null>(null);
  /** A job is being run; the site re-sends it whenever this tab is ready. */
  const running = useRef(false);
  /** A tab that remembers its ending has done its part already. */
  const started = useRef(remembered !== null);
  const startedAt = useRef<number | null>(null);
  /** The page cancelled before this tab's own press went out. */
  const cancelled = useRef(false);
  /** This tab has pressed: one press per tab, however often the effect runs. */
  const pressing = useRef(false);
  /**
   * An update rather than a publish job: the page that cannot build pressed
   * Update site. Reported with `update-done`, never `done`, because it can end
   * without a deploy -- see `ToSite`.
   */
  const updating = useRef(remembered?.kind === "update");
  const [updateOutcome, setUpdateOutcome] = useState<SiteUpdateOutcome | null>(
    () => (remembered?.kind === "update" ? remembered.outcome : null),
  );

  useEffect(() => {
    let closed = false;
    const client = createStudioJobClient({ api: "/api/val" });
    const report = (message: Parameters<TabHandoff["report"]>[0]) =>
      tab.current?.report(message);

    const startUpdate = () => {
      if (started.current) return;
      started.current = true;
      updating.current = true;
      setWaiting({ kind: "started", waitedMs: 0, jobId: null });
      void runSiteUpdate({
        client: createStudioPublishClient({ api: "/api/val" }),
        deploy,
      }).then((outcome) => {
        setUpdateOutcome(outcome);
        // Opened again, the tab shows this rather than updating again.
        rememberEnding(id, { kind: "update", outcome });
        report({ type: "update-done", outcome });
        if (outcome.status === "updated") setClosingIn(CLOSE_AFTER_S);
      });
    };

    /*
     * Once per job. A job the site sends AGAIN after this tab's run ended is
     * a new run -- content kept it at its step for another attempt.
     */
    const runJob = (
      job: PublishTabJob,
      asTab: string,
      requestId: string | null,
    ) => {
      if (running.current || updating.current) return;
      running.current = true;
      started.current = true;
      if (startedAt.current === null) startedAt.current = Date.now();
      setGoingLive(null);
      // A job after this tab said it had nothing to build: it has now.
      setClosingIn(null);
      setWaiting((prev) => ({
        kind: "started",
        waitedMs: prev.kind === "waiting" ? Date.now() - prev.since : 0,
        jobId: job.id,
      }));
      void (async () => {
        const result = await runJobToEnd({
          client,
          job,
          tab: asTab,
          run: () =>
            runStudioJob({
              client,
              job,
              tab: asTab,
              deploy: (prepared) => deployPreparedJob(deploy, prepared),
              onPhase: () => {},
            }),
        });
        running.current = false;
        report({ type: "job-result", result });
        if (result.status === "handed-off") {
          // Content checks it and puts it live; the page that opened this follows it.
          setGoingLive({ kind: "handed-off" });
          setClosingIn(CLOSE_AFTER_S);
          return;
        }
        /*
         * Why, in content's words when it has them: the request's message is
         * what the Studio's toast says ("prepare failed 3 times: ..."), and
         * this page saying something vaguer beside it read as two failures.
         */
        const said =
          result.status === "failed" && requestId !== null
            ? await failureOf(client, requestId)
            : null;
        const message =
          said ??
          (result.status === "lost"
            ? "Another tab took over this publish."
            : "The publish could not be built here. Nothing on the live site changed.");
        const details =
          result.status === "failed" && result.message !== message
            ? result.message
            : undefined;
        if (closed) return;
        setGoingLive({
          kind: "failed",
          message,
          ...(details !== undefined ? { details } : {}),
        });
        // The page's card ends here too: nothing more will come from this tab.
        report({
          type: "done",
          result: {
            status: "failed",
            message: details ?? message,
            problems: [],
          },
          ms: Date.now() - (startedAt.current ?? Date.now()),
          summary: message,
        });
      })();
    };

    /**
     * The press did not happen: said here, and on the page's card. An answer
     * -- the gate refused -- is remembered, so the tab opened again says it
     * again; a wait that ran out is not, because opened again it may not.
     */
    const notPressed = (
      message: string,
      details?: string,
      options: { answer?: boolean } = {},
    ) => {
      if (options.answer) {
        rememberEnding(id, {
          kind: "not-pressed",
          message,
          ...(details !== undefined ? { details } : {}),
        });
      }
      setWaiting({
        kind: "cancelled",
        message,
        ...(details !== undefined ? { details } : {}),
      });
      report({
        type: "done",
        result: { status: "failed", message: details ?? message, problems: [] },
        ms: 0,
        summary: message,
      });
    };

    /**
     * Follow a press already made -- this tab's, or one it finds made when it
     * is opened again -- until it has a job here or has settled.
     */
    const follow = async (
      intent: PressIntent,
      request: PublishRequestStatus,
    ) => {
      if (isSettled(request)) {
        setSettled(request);
        return;
      }
      setWaiting({
        kind: "following",
        since: Date.now(),
        label:
          request.kind === "queued"
            ? "Waiting for the publish before it"
            : "Finishing the publish",
      });
      const followed = await followRequest({
        client,
        requestId: intent.requestId,
        tab: intent.tab,
        stopped: () => closed || running.current,
      });
      if (followed.kind === "job") {
        runJob(followed.job, intent.tab, intent.requestId);
      } else if (followed.kind === "settled" && !closed) {
        setSettled(followed.request);
      }
    };

    /** Press for the page: see `pressForPage`. */
    const press = async (intent: PressIntent) => {
      /*
       * Opened again after its press -- a reload, the back button, the URL
       * reopened: show that publish, and never make it a second time.
       */
      const already = await pressedAlready({
        client,
        requestId: intent.requestId,
      });
      if (closed || started.current || cancelled.current || pressing.current)
        return;
      if (already !== null) {
        pressing.current = true;
        await follow(intent, already);
        return;
      }
      // Never made, and too old to make now: nobody is pressing this.
      if (stale) {
        pressing.current = true;
        notPressed(STALE_MESSAGE);
        return;
      }
      const loaded = await whenReady(() => {
        const current = valRef.current;
        return (
          current !== null &&
          current.system.host.initializedAt() !== null &&
          current.system.patchStore.chainSettled()
        );
      });
      /*
       * Then the page's last change: pressed without it, the publish leaves
       * out what the editor just did, or finds nothing at all. It arrives when
       * the page's save does -- on an iPhone, maybe only once the editor has
       * gone back to it -- so this waits, rather than fails, for a long time.
       * Or another publish has taken it already, which only the server can
       * say: a fresh tab's chain never lists a shipped change.
       */
      const after = intent.after;
      const change =
        !loaded || after === null
          ? "arrived"
          : await waitForChange({
              inChain: () => {
                const current = valRef.current;
                return (
                  current !== null &&
                  hasChange(current.system.patchStore, after)
                );
              },
              serverState: () =>
                askServerAbout(
                  valRef.current?.system.patchStore ?? null,
                  after,
                ),
            });
      // A job the page handed over meanwhile, or a cancel, has the tab now.
      if (closed || started.current || cancelled.current || pressing.current)
        return;
      pressing.current = true;
      const system = valRef.current?.system;
      if (!loaded || system === undefined) {
        notPressed(NOT_LOADED_MESSAGE);
        return;
      }
      if (change === "timed-out") {
        notPressed(CHANGE_NOT_SAVED_MESSAGE);
        return;
      }
      const chain = () =>
        system.patchStore.allRecords().map((record) => record.patchId);
      const outcome = await pressForPage({
        intent,
        client,
        chain,
        publish: (pressAs) =>
          system.publish(chain(), "", { request: true, pressAs }),
      });
      if (closed) return;
      if (outcome.kind === "not-pressed") {
        if (outcome.nothingToPublish && change === "shipped") {
          /*
           * Another publish took the editor's change before this tab could:
           * it is on the site, which is the answer they came here for.
           */
          setSettled(SHIPPED_ELSEWHERE);
          return;
        }
        notPressed(outcome.message, outcome.details, {
          answer: outcome.durable,
        });
        return;
      }
      const building = pressBuilds(outcome);
      report({
        type: "pressed",
        requestId: outcome.requestId,
        patchIds: outcome.patchIds,
        replaces: outcome.replaces,
        request: outcome.request,
        building,
      });
      if (outcome.job !== null && outcome.job.step !== null) {
        runJob(outcome.job, intent.tab, outcome.requestId);
        return;
      }
      /*
       * Queued behind another job: this tab takes its turn, as the page's.
       * Joined to a job in flight, or settled at once: nothing to build, and
       * the tab says where it ended up.
       */
      await follow(intent, outcome.request);
    };

    const handoff = joinHandoff(id, (message) => {
      if (message.type === "cancel") {
        if (!started.current) {
          cancelled.current = true;
          setWaiting({ kind: "cancelled", message: message.message });
        }
        return;
      }
      if (message.type === "update") {
        startUpdate();
        return;
      }
      runJob(message.job, message.tab, message.requestId);
    });
    tab.current = handoff;
    let noIntent: ReturnType<typeof setTimeout> | null = null;
    if (intent === null) {
      noIntent = setTimeout(() => {
        if (!started.current && !cancelled.current) {
          setWaiting({ kind: "cancelled", message: NO_INTENT_MESSAGE });
        }
      }, NO_INTENT_TIMEOUT_MS);
    } else if (remembered !== null) {
      // Opened again: it shows how it ended, set from `remembered` above.
    } else if (intent.kind === "update") {
      if (stale) setWaiting({ kind: "cancelled", message: STALE_MESSAGE });
      else startUpdate();
    } else void press(intent);
    return () => {
      closed = true;
      if (noIntent !== null) clearTimeout(noIntent);
      handoff.close();
    };
  }, [id, deploy, intent, stale, remembered]);

  // Ticks the elapsed time here, and relays it to the waiting page.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (updating.current) {
      if (state.status !== "running") return;
      tab.current?.report({
        type: "phase",
        label: describeDeployPhase(state.phase),
        elapsedMs: now - state.startedAt,
        percent: deployPercent(state.phase),
      });
      return;
    }
    if (!started.current || startedAt.current === null) return;
    if (state.status !== "running" || goingLive !== null) return;
    tab.current?.report({
      type: "phase",
      label: describeDeployPhase(state.phase),
      elapsedMs: now - startedAt.current,
      percent: deployPercent(state.phase),
    });
  }, [state, now, goingLive]);

  useEffect(() => {
    if (closingIn === null) return;
    if (closingIn <= 0) {
      window.close();
      return;
    }
    const timer = setTimeout(() => setClosingIn(closingIn - 1), 1000);
    return () => clearTimeout(timer);
  }, [closingIn]);

  const steps = stepsOf(waiting, state, updating.current, goingLive, settled);
  const settledResult = settled === null ? null : settledMessage(settled);
  const result: PublishPageResult | undefined = updating.current
    ? updateResultOf(updateOutcome, closingIn)
    : waiting.kind === "cancelled"
      ? {
          kind: "failed",
          message: waiting.message,
          ...(waiting.details !== undefined
            ? { details: waiting.details }
            : {}),
        }
      : settledResult !== null
        ? settledResult.live
          ? { kind: "live" }
          : { kind: "failed", message: settledResult.message }
        : goingLive?.kind === "handed-off"
          ? {
              kind: "handed-off",
              ...(closingIn !== null && closingIn > 0
                ? { closingInS: closingIn }
                : {}),
            }
          : goingLive?.kind === "failed"
            ? {
                kind: "failed",
                message: goingLive.message,
                ...(goingLive.details ? { details: goingLive.details } : {}),
              }
            : undefined;
  const elapsedMs =
    waiting.kind === "waiting" || waiting.kind === "following"
      ? now - waiting.since
      : updating.current
        ? state.status === "running"
          ? now - state.startedAt
          : state.status === "done"
            ? state.ms
            : 0
        : startedAt.current !== null
          ? now - startedAt.current
          : 0;

  return (
    <div style={{ height: "100svh" }}>
      <StudioPublishPage
        {...(waiting.kind === "started" && waiting.jobId
          ? { jobId: waiting.jobId }
          : {})}
        steps={steps}
        elapsedMs={elapsedMs}
        result={result}
        onViewSite={() => leaveTo("/")}
        onOpenStudio={() => leaveTo("/val")}
        onClose={() => window.close()}
      />
    </div>
  );
}

/** What the page says when the tab ran an update. `undefined` while it runs. */
function updateResultOf(
  outcome: SiteUpdateOutcome | null,
  closingIn: number | null,
): PublishPageResult | undefined {
  if (outcome === null) return undefined;
  switch (outcome.status) {
    case "updated":
      return {
        kind: "live",
        ms: 0,
        ...(closingIn !== null && closingIn > 0
          ? { closingInS: closingIn }
          : {}),
      };
    case "current":
      return { kind: "failed", message: "The site is already up to date." };
    case "unavailable":
      return { kind: "failed", message: outcome.message };
    case "failed":
      return {
        kind: "failed",
        message: outcome.message,
        details: outcome.details,
      };
  }
}

function stepsOf(
  waiting: Waiting,
  state: StudioDeployState,
  update: boolean,
  goingLive: GoingLive | null,
  settled: PublishRequestStatus | null,
): PublishStep[] {
  /*
   * Following a publish rather than building it: its steps are another tab's,
   * or content's, so the one step here is the wait for it to end.
   */
  if (waiting.kind === "following" || (settled !== null && !update)) {
    const label =
      waiting.kind === "following" ? waiting.label : "Finishing the publish";
    return [
      {
        label,
        status:
          settled === null
            ? "current"
            : settledMessage(settled).live
              ? "done"
              : "failed",
      },
    ];
  }
  // An update requests nothing; its first step is asking the platform for it.
  const first = update ? "Starting the update" : "Starting the publish";
  const begun: PublishStep =
    waiting.kind === "waiting"
      ? { label: first, status: "current" }
      : waiting.kind === "cancelled"
        ? { label: first, status: "failed" }
        : {
            label: first,
            status: "done",
            ms: waiting.waitedMs,
          };
  const finished = new Map<DeployPhase["kind"], number>();
  const recorded =
    state.status === "running"
      ? (state.steps ?? [])
      : state.status === "done"
        ? state.steps
        : [];
  for (const step of recorded) finished.set(step.kind, step.ms);
  const current = state.status === "running" ? state.phase : null;
  const failed =
    goingLive?.kind === "failed" ||
    (state.status === "done" && state.result.status === "failed");
  /*
   * A publish job's steps end at the upload: checking the site renders and
   * putting it live are content's, run without this tab, so they are not
   * listed as steps it is waiting for. An update runs them here.
   */
  const order = update
    ? ORDER
    : ORDER.filter(
        (kind) =>
          (kind !== "verifying" && kind !== "promoting") ||
          finished.has(kind) ||
          current?.kind === kind,
      );
  const rest = order.map((kind): PublishStep => {
    if (current !== null && current.kind === kind) {
      // The live wording while it runs: "Uploading 3 of 7".
      return { label: describeDeployPhase(current), status: "current" };
    }
    const label = describeDeployStep(kind);
    const ms = finished.get(kind);
    if (ms !== undefined) return { label, status: "done", ms };
    return { label, status: "todo" };
  });
  if (failed) {
    // The last step that ran is where it stopped.
    const last = [...rest].reverse().find((step) => step.status === "done");
    if (last) last.status = "failed";
  }
  return [begun, ...rest];
}

/**
 * The request's own failure message, once content has settled it, or `null`
 * if it does not within a few seconds -- a tab's run can end a moment before
 * content records why.
 */
async function failureOf(
  client: ReturnType<typeof createStudioJobClient>,
  requestId: string,
): Promise<string | null> {
  for (let read = 0; read < FAILURE_READS; read++) {
    const status = await client.requestStatus(requestId).catch(() => null);
    if (status !== null && isSettled(status))
      return status.kind === "failed" ? status.message : null;
    await new Promise((resolve) => setTimeout(resolve, FAILURE_READ_MS));
  }
  return null;
}
