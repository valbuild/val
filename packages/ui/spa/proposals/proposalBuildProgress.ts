import { describeDeployPhase, deployPercent } from "../publish/deployProgress";
import type { StudioDeployState } from "../publish/useStudioDeploy";
import type { StudioBuildStep } from "./proposalCode";
import type { ServerBuildProgress } from "@valbuild/shared/publish";

/**
 * A build of the proposal as it is shown: in the upgrade's dialog, and by the
 * builder tab to the page that opened it. One place for the words, so the
 * tab and the page say the same.
 *
 * The deploy is the middle of the build and has steps of its own -- reading,
 * building, uploading N of M -- which are its state's. Around it are the
 * proposal's: reading what to build, and serving the build at the proposal's
 * address, which on an upgrade is most of the wait.
 *
 * `percent` is the deploy's share, kept below 90 so the serving after it has
 * room; `null` while nothing can say how far along it is.
 */
export type ProposalBuildProgress = { label: string; percent: number | null };

/** Where the deploy's percent is squeezed to: serving takes the rest. */
const DEPLOY_SHARE = 0.85;

export function proposalBuildProgress(
  step: StudioBuildStep | null,
  deploy: StudioDeployState,
): ProposalBuildProgress {
  switch (step?.kind) {
    case undefined:
    case "reading":
      return { label: "Reading the proposal", percent: 0 };
    case "deploying":
      return deploy.status === "running"
        ? {
            label: describeDeployPhase(deploy.phase),
            percent: Math.round(deployPercent(deploy.phase) * DEPLOY_SHARE),
          }
        : { label: "Building", percent: null };
    case "on-server":
      return onServerProgress(step.progress ?? null);
    case "serving":
      return {
        label: "Serving the build at the proposal's address",
        percent: Math.round(100 * DEPLOY_SHARE),
      };
    case "waiting":
      return {
        label: "Val Build is still serving the build at the proposal's address",
        percent: null,
      };
  }
}

/**
 * Val Build's build, as far as it says (`buildProgress`): waiting in its
 * queue, the builder's steps across most of the bar, then checking the build
 * renders and serving it. Nothing said is a build without a percent, as
 * before.
 */
function onServerProgress(
  progress: ServerBuildProgress | null,
): ProposalBuildProgress {
  if (progress === null) {
    return { label: "Building on Val Build", percent: null };
  }
  if (progress.built) {
    return {
      label: "Checking the page and serving it",
      percent: Math.round(100 * DEPLOY_SHARE),
    };
  }
  if (progress.step !== null && progress.step.of > 0) {
    const done = Math.min(progress.step.index - 1, progress.step.of);
    return {
      label: progress.step.label,
      percent: Math.round(
        5 + (100 * DEPLOY_SHARE - 5) * (done / progress.step.of),
      ),
    };
  }
  if (progress.queued !== null && progress.queued > 0) {
    return {
      label:
        progress.queued === 1
          ? "Waiting for Val Build: 1 build ahead"
          : `Waiting for Val Build: ${progress.queued} builds ahead`,
      percent: 0,
    };
  }
  return { label: "Starting the build", percent: 5 };
}
