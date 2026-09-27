import type { DeployPhase } from "./runStudioDeploy";
import type { StudioDeployState } from "./useStudioDeploy";

/**
 * What a publish built in the tab is doing, as one line for the status bar.
 *
 * Plain functions rather than a component, so the wording is tested without
 * rendering anything.
 */

export function seconds(ms: number): string {
  return `${Math.max(0, Math.round(ms / 1000))}s`;
}

export function describeDeployPhase(phase: DeployPhase): string {
  switch (phase.kind) {
    case "getting-ready":
      return "Loading the builder";
    case "reading":
      return "Reading the site";
    case "building":
      return "Building";
    case "declaring":
      return "Preparing the upload";
    case "uploading":
      return phase.total > 0
        ? `Uploading ${phase.done} of ${phase.total}`
        : "Uploading";
    case "confirming":
      return "Checking the upload";
    case "verifying":
      return "Checking the site renders";
    case "promoting":
      return "Going live";
    case "propagating":
      return "Live — waiting for the site to show it";
  }
}

/** A step as a row of a list: the same words, without a running count. */
export function describeDeployStep(kind: DeployPhase["kind"]): string {
  switch (kind) {
    case "uploading":
      return "Uploading";
    case "propagating":
      return "Waiting for the site to show it";
    default:
      return describeDeployPhase({ kind });
  }
}

/**
 * Where each step starts, in percent of the whole publish.
 *
 * Weighted by what the steps usually cost, not counted: building and checking
 * the site renders are most of a publish, and a bar that gave the two-hundred-
 * millisecond steps as much room as those would crawl through the middle and
 * leap at the ends.
 */
const STARTS: Record<DeployPhase["kind"], number> = {
  "getting-ready": 0,
  reading: 8,
  building: 12,
  declaring: 40,
  uploading: 44,
  confirming: 60,
  verifying: 64,
  promoting: 86,
  propagating: 92,
};
const ORDER: DeployPhase["kind"][] = [
  "getting-ready",
  "reading",
  "building",
  "declaring",
  "uploading",
  "confirming",
  "verifying",
  "promoting",
  "propagating",
];

/**
 * How far a publish has got, 0-99. Never 100: done is not a percentage, it is
 * the line going away.
 */
export function deployPercent(phase: DeployPhase): number {
  const start = STARTS[phase.kind];
  if (phase.kind === "uploading" && phase.total > 0) {
    const end = STARTS.confirming;
    return Math.min(
      99,
      Math.round(start + ((end - start) * phase.done) / phase.total),
    );
  }
  return start;
}

/** The order the steps run in, for a list of them. */
export const DEPLOY_STEPS: readonly DeployPhase["kind"][] = ORDER;

/**
 * The status bar's line while a publish runs, or `null`.
 *
 * `null` once it is done, whether it went live or not: a publish that went
 * live says so in the deploy summary beside this ("Live"), and one that failed
 * says so in its own message. What this line is for is the wait.
 */
export function describeDeploy(state: StudioDeployState): string | null {
  return state.status === "running"
    ? `Publishing ${deployPercent(state.phase)}%`
    : null;
}

/**
 * What went wrong, for the person who pressed Publish -- in a sentence, with
 * the step that failed and nothing they would have to look up.
 *
 * The technical message is still shown, under "Details": it is what a bug
 * report needs. It is not what the page leads with, because the one the Studio
 * used to lead with named two HTTP headers and a SharedArrayBuffer to someone
 * who had just changed a title.
 *
 * `crossOriginIsolated` is asked for the builder step because that failure has
 * a cause the reader CAN act on: the browser. Every other step's failure is
 * ours, and the sentence says the change is safe rather than guessing a fix.
 */
export function describeDeployFailure(
  failedAt: DeployPhase["kind"] | undefined,
  scope: { crossOriginIsolated?: boolean } = globalThis,
): string {
  switch (failedAt) {
    case "getting-ready":
      return scope.crossOriginIsolated === true
        ? "The site builder could not be loaded. Check the connection and publish again."
        : "This browser cannot build the site, so it could not be published from here. Publish from Chrome, Edge or Firefox on a computer.";
    case "reading":
      return "The site's current files could not be read, so nothing was built. Publish again to retry.";
    case "building":
      return "The site could not be built from this change. Nothing on the live site changed.";
    case "declaring":
    case "uploading":
    case "confirming":
      return "The new version could not be uploaded. Nothing on the live site changed. Publish again to retry.";
    case "verifying":
      return "The new version did not pass its check, so the live site was left as it was.";
    case "promoting":
    case "propagating":
      return "The new version was built but could not be made live. Publish again to retry.";
    case undefined:
      return "The site could not be rebuilt. Publish again to retry.";
  }
}
