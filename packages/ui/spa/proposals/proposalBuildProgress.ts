import { describeDeployPhase, deployPercent } from "../publish/deployProgress";
import type { StudioDeployState } from "../publish/useStudioDeploy";
import type { ProposalBuildStep } from "./proposalCode";

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
  step: ProposalBuildStep | null,
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
