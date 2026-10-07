import { useEffect, useRef, useState } from "react";
import { useStudioDeployState } from "../ValProvider";
import {
  joinHandoff,
  leaveTo,
  readHandoffIntent,
  type HandoffIntent,
  type TabHandoff,
} from "../../publish/handoff";
import {
  CHANGE_NOT_SAVED_MESSAGE,
  CHANGE_TIMEOUT_MS,
  hasChange,
  NOT_LOADED_MESSAGE,
  nothingToBuildMessage,
  type PressIntent,
  pressBuilds,
  pressForPage,
  waitForQueuedJob,
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
 * How long a tab with nothing in its URL waits to be told what to do: one
 * opened by a page from before intents, which hands it the job over the
 * channel. Not for ever -- a page that reloaded, or was closed, never will.
 * A job that arrives after this still runs.
 */
const NO_INTENT_TIMEOUT_MS = 5 * 60_000;
const NO_INTENT_MESSAGE =
  "The page you published from never sent this tab the publish, so nothing was published. Publish again from that page.";

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
   * What this tab is to do, from its URL. Read once, like the handoff's id:
   * the tab is for this one press.
   */
  const [intent] = useState<HandoffIntent | null>(() =>
    typeof window === "undefined"
      ? null
      : readHandoffIntent(window.location.search),
  );
  const [waiting, setWaiting] = useState<Waiting>(() => ({
    kind: "waiting",
    since: Date.now(),
  }));
  const [goingLive, setGoingLive] = useState<GoingLive | null>(null);
  const [closingIn, setClosingIn] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const tab = useRef<TabHandoff | null>(null);
  /** A job is being run; the site re-sends it whenever this tab is ready. */
  const running = useRef(false);
  const started = useRef(false);
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
  const updating = useRef(false);
  const [updateOutcome, setUpdateOutcome] = useState<SiteUpdateOutcome | null>(
    null,
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

    /** The press did not happen: said here, and on the page's card. */
    const notPressed = (message: string, details?: string) => {
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

    /** The press left this tab nothing to build. The page follows the request. */
    const nothingToBuild = (
      pressed: {
        requestId: string;
        patchIds: string[];
        replaces: string | null;
      },
      request: PublishRequestStatus,
    ) => {
      report({ type: "pressed", ...pressed, request, building: false });
      setWaiting({
        kind: "cancelled",
        message: nothingToBuildMessage(request),
      });
    };

    /** Press for the page: see `pressForPage`. */
    const press = async (intent: PressIntent) => {
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
       */
      const saved =
        loaded &&
        (await whenReady(
          () => {
            const current = valRef.current;
            return (
              current !== null &&
              hasChange(current.system.patchStore, intent.after)
            );
          },
          { timeoutMs: CHANGE_TIMEOUT_MS },
        ));
      // A job the page handed over meanwhile, or a cancel, has the tab now.
      if (closed || started.current || cancelled.current || pressing.current)
        return;
      pressing.current = true;
      const system = valRef.current?.system;
      if (!loaded || system === undefined) {
        notPressed(NOT_LOADED_MESSAGE);
        return;
      }
      if (!saved) {
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
        notPressed(outcome.message, outcome.details);
        return;
      }
      const pressed = {
        requestId: outcome.requestId,
        patchIds: outcome.patchIds,
        replaces: outcome.replaces,
      };
      if (!pressBuilds(outcome)) {
        nothingToBuild(pressed, outcome.request);
        return;
      }
      report({
        type: "pressed",
        ...pressed,
        request: outcome.request,
        building: true,
      });
      if (outcome.job !== null && outcome.job.step !== null) {
        runJob(outcome.job, intent.tab, outcome.requestId);
        return;
      }
      // Queued behind another job: this tab takes its turn, as the page's.
      const waited = await waitForQueuedJob({
        client,
        requestId: outcome.requestId,
        tab: intent.tab,
        stopped: () => closed || running.current,
      });
      if (waited.kind === "job") {
        runJob(waited.job, intent.tab, outcome.requestId);
      } else if (waited.kind === "moved" && !closed) {
        nothingToBuild(pressed, waited.request);
      }
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
    } else if (intent.kind === "update") startUpdate();
    else void press(intent);
    return () => {
      closed = true;
      if (noIntent !== null) clearTimeout(noIntent);
      handoff.close();
    };
  }, [id, deploy, intent]);

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

  const steps = stepsOf(waiting, state, updating.current, goingLive);
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
    waiting.kind === "waiting"
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
): PublishStep[] {
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
