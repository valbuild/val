import type { DeployStep, StudioDeployState } from "./useStudioDeploy";
import { isSettled, type PublishJobsState } from "./publishJobs";

/**
 * How far a publish has got, as every progress surface already reads it: one
 * `StudioDeployState`, whether the publish is a build in this tab, a job
 * content is verifying and sealing, or a press queued behind another.
 *
 * The tab's own deploy is only the middle of a publish job. Before it, the
 * press may wait its turn (`queued`) or be built by another tab; after it,
 * content verifies and seals -- `verifying` until the request is Live. So the
 * surfaces are driven by the newest press this tab made, and by the deploy
 * only while it runs, or when it is newer than that press: an update, which
 * is not a job at all.
 */
export function publishProgress(
  deploy: StudioDeployState,
  jobs: PublishJobsState,
  now: number,
): StudioDeployState {
  if (deploy.status === "running") return deploy;
  const latest = jobs.requests.at(-1);
  if (latest === undefined) return deploy;
  if (
    deploy.status === "done" &&
    deploy.result.status !== "uploaded" &&
    (deploy.finishedAt ?? 0) > latest.pressedAt &&
    // A job's build that failed is newer than its press, and says more about
    // it than the request does: which step it failed at.
    (isSettled(latest.status) || deploy.result.status !== "failed")
  ) {
    return deploy;
  }
  const built: DeployStep[] = deploy.status === "done" ? deploy.steps : [];
  const running = (
    phase: Extract<StudioDeployState, { status: "running" }>["phase"],
    phaseStartedAt: number,
    steps: DeployStep[] = [],
  ): StudioDeployState => ({
    status: "running",
    phase,
    startedAt: latest.pressedAt,
    phaseStartedAt,
    steps,
    commit: null,
  });

  const status = latest.status;
  if (!isSettled(status)) {
    if (jobs.running !== null) {
      /*
       * This tab built the job and is handing it to content: the upload is
       * done and the check is next. Not "reading", which is where the bar
       * started -- that sent a publish from 60% back to 8% and up to 64%.
       */
      if (
        jobs.running.phase?.kind === "handing-off" &&
        deploy.status === "done" &&
        deploy.result.status === "uploaded" &&
        (deploy.finishedAt ?? 0) >= latest.pressedAt
      ) {
        return running(
          { kind: "confirming" },
          deploy.finishedAt ?? latest.pressedAt,
          built,
        );
      }
      /*
       * Preparing it, or between two runs of it: the deploy has not begun.
       * The deploy's own first step, so the bar does not step back when it
       * does.
       */
      return running({ kind: "getting-ready" }, latest.pressedAt);
    }
    if (status.kind === "queued") {
      return running({ kind: "queued" }, latest.pressedAt);
    }
    if (latest.handedOffAt !== undefined) {
      // Content checks what this tab built; CI builds what content pushed.
      return latest.builtBy === "ci"
        ? running({ kind: "building" }, latest.handedOffAt)
        : running({ kind: "verifying" }, latest.handedOffAt, built);
    }
    // Being built somewhere else: a builder tab, or a tab that took it.
    return running({ kind: "building" }, latest.pressedAt);
  }

  const settledAt = latest.settledAt ?? now;
  const ms = Math.max(0, settledAt - latest.pressedAt);
  const steps: DeployStep[] =
    latest.handedOffAt !== undefined
      ? [
          ...built,
          {
            kind: "verifying",
            ms: Math.max(0, settledAt - latest.handedOffAt),
          },
        ]
      : built;
  switch (status.kind) {
    case "live":
      return {
        status: "done",
        result: { status: "live", url: null },
        ms,
        steps,
        commit: status.commit,
        finishedAt: settledAt,
      };
    case "nothing-to-publish":
      return {
        status: "done",
        result: { status: "already-live", url: null },
        ms,
        steps,
        commit: null,
        finishedAt: settledAt,
      };
    case "failed":
    case "cancelled":
      return {
        status: "done",
        result: {
          status: "failed",
          message:
            status.kind === "failed"
              ? status.message
              : "The publish was cancelled.",
          problems: [],
        },
        ms,
        steps,
        commit: null,
        failedAt:
          deploy.status === "done" && deploy.result.status === "failed"
            ? (deploy.failedAt ?? null)
            : latest.handedOffAt !== undefined
              ? "verifying"
              : null,
        finishedAt: settledAt,
      };
    case "queued":
    case "publishing":
      // Not settled: answered above. Here for the compiler.
      return deploy;
  }
}
