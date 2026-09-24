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
 * The line while a publish runs, and after it finished. `null` for nothing to
 * say: no publish yet, or one that failed (the failure has its own message).
 */
export function describeDeploy(
  state: StudioDeployState,
  now: number,
): string | null {
  switch (state.status) {
    case "idle":
      return null;
    case "running":
      return `${describeDeployPhase(state.phase)} · ${seconds(now - state.startedAt)}`;
    case "done":
      switch (state.result.status) {
        case "failed":
          return null;
        case "already-live":
          return "Already live";
        case "live":
          return state.result.visible === false
            ? `Live after ${seconds(state.ms)} — this location may take up to a minute more`
            : `Live after ${seconds(state.ms)}`;
      }
  }
}
