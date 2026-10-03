import type { ShellDeployment } from "../components/shell/types";
import { summarizeDeployments } from "../components/shell/Deployments";
import { deployPercent, describeDeployPhase } from "./deployProgress";
import type { StudioDeployState } from "./useStudioDeploy";
import {
  EDGE_CACHE_MS,
  indicatorOfSummary,
  type PublishIndicator,
} from "./publishIndicatorView";

export {
  EDGE_CACHE_MS,
  describeIndicator,
  indicatorPercent,
  explainIndicator,
  isInFlight,
  type PublishIndicator,
} from "./publishIndicatorView";

/**
 * The status bar's one publish indicator: whether the site is still on its way
 * to what has been published, for this editor and for everyone else.
 *
 * It spins until a visitor ANYWHERE gets the change, and that is a minute
 * later than "Live". Content moves the site's pointer at the seal, but the
 * loader reads that pointer from KV, and every Cloudflare location caches it
 * for up to {@link EDGE_CACHE_MS} (valbuild/home, docs/app-mode.md, "Live:
 * reported, never waited on"). Nothing a browser can ask answers for every
 * location -- it reaches one -- so the end of that window is a clock, not a
 * poll. When it stops spinning, every visitor sees the change.
 *
 * Plain functions, so the states are tested and drawn in stories without a
 * provider.
 */

/**
 * A job on this branch as the content websocket last reported it. Every
 * Studio on the branch hears every job, so this is how a publish another
 * editor pressed reaches this one.
 */
export type ObservedJob = {
  id: string;
  /** Content's job status: running, sealed, superseded, failed, ... */
  status: string;
  /** When this Studio last heard about it. */
  seenAt: number;
  /** When this Studio first heard it was sealed. */
  sealedAt?: number;
};

/**
 * How long a job reported running is believed without hearing of it again.
 * A step or a renewal moves it far more often than this; a job silent for
 * longer lost the message that ended it.
 */
export const RUNNING_JOB_STALE_MS = 10 * 60_000;

export function publishIndicator(input: {
  /** This tab's publish, seen through its publish jobs: `publishProgress`. */
  own: StudioDeployState;
  /**
   * The step a builder tab this page opened last reported, and how far it
   * has got, while it builds. WebKit's publish: this page's own deploy never
   * runs, so the tab's numbers are the only ones there are.
   */
  builder?: { step: string; percent: number | null } | null;
  /** Every job on the branch, as the websocket reported it. */
  jobs?: readonly ObservedJob[];
  /** The deploy feed, when there is one. */
  deployments?: ShellDeployment[];
  /** Managed: a commit is recorded at its seal, when it goes live. */
  studioIsDeployer?: boolean;
  now: number;
}): PublishIndicator {
  const { own, now } = input;
  const studioIsDeployer = input.studioIsDeployer ?? false;
  const jobs = input.jobs ?? [];
  const deployments = input.deployments ?? [];

  if (own.status === "running") {
    const builder = input.builder ?? null;
    return {
      kind: "publishing",
      mine: true,
      step: builder?.step ?? describeDeployPhase(own.phase),
      percent: builder !== null ? builder.percent : deployPercent(own.phase),
    };
  }
  if (
    jobs.some(
      (job) =>
        job.status === "running" && now - job.seenAt < RUNNING_JOB_STALE_MS,
    )
  ) {
    return { kind: "publishing", mine: false, step: null, percent: null };
  }

  /*
   * When the site last moved. Ours is the request's own Live; another
   * editor's is the seal the socket reported, or -- for a Studio that opened
   * after it -- the managed feed's newest row, which is recorded at the seal.
   * Connected: a sealed job is a push CI has yet to build, and the feed says
   * "Building" for it until then.
   */
  const ownLiveAt =
    own.status === "done" && own.result.status === "live"
      ? (own.finishedAt ?? null)
      : null;
  let liveAt = ownLiveAt;
  const moved = (at: number | null | undefined) => {
    if (at !== null && at !== undefined && (liveAt === null || at > liveAt)) {
      liveAt = at;
    }
  };
  if (studioIsDeployer) {
    for (const job of jobs) {
      if (job.status === "sealed") moved(job.sealedAt);
    }
    const newest = deployments[0];
    if (newest !== undefined) {
      const at = new Date(newest.updatedAt).getTime();
      if (!Number.isNaN(at)) moved(at);
    }
  }
  if (liveAt !== null && now < liveAt + EDGE_CACHE_MS) {
    return {
      kind: "reaching",
      mine: liveAt === ownLiveAt,
      everywhereAt: liveAt + EDGE_CACHE_MS,
    };
  }

  // Ours failed, and nothing has gone live since: Try again is in its toast.
  if (
    own.status === "done" &&
    own.result.status === "failed" &&
    (liveAt === null || (own.finishedAt ?? 0) > liveAt)
  ) {
    return { kind: "failed" };
  }

  return indicatorOfSummary(
    summarizeDeployments(deployments, studioIsDeployer),
  );
}
