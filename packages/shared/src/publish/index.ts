/**
 * A site's build, published through content, from a browser: the deploy
 * (read what to build and on what, build it, upload it, confirm it) and the
 * publish job a tab runs (valbuild/home `docs/app-mode.md`, "Publishing is a
 * queued job").
 *
 * Here rather than in the Studio because two pages run it: the Studio, which
 * is a managed project's deployer, and home's upgrade page, which builds and
 * publishes an upgrade proposal and pins this package at an exact version so
 * that a site's own Val never reaches its upgrade (valbuild/home
 * `docs/plans/upgrades-v2.md`, piece E). The builder is the caller's: see
 * `StudioBuilder`.
 */
export type { StudioBuilder } from "./builder";
export {
  StudioPublishError,
  callJson,
  isTransientPublishError,
  onPublishRefusal,
} from "./callJson";
export {
  StudioUploadError,
  createStudioPublishClient,
  isExpiredSlot,
  publishApiOf,
  type CarriedArtifact,
  type LivePublicFiles,
  type PublishApiAt,
  type StudioPublishClient,
} from "./publishClient";
export {
  runStudioPublish,
  type PublishPhase,
  type StudioPublishResult,
} from "./runStudioPublish";
export {
  DEPLOY_STOPPED_MESSAGE,
  carriedInto,
  runStudioDeploy,
  splitBinaryFiles,
  withCommittedFiles,
  type CommittedBinaryFiles,
  type DeployPhase,
  type StudioDeployOptions,
  type StudioDeployResult,
} from "./runStudioDeploy";
export {
  STUDIO_OUT_OF_DATE,
  STUDIO_OUT_OF_DATE_MESSAGE,
  layerMoved,
  loadedLayer,
  markStudioOutOfDate,
  readLiveLayer,
  rememberLoadedLayer,
  resetLoadedLayerForTests,
  siteMovedSinceLoad,
  studioOutOfDateRefusals,
  subscribeStudioOutOfDate,
  type LayerReading,
} from "./loadedLayer";
export {
  MergePrepareAnswer,
  createStudioJobClient,
  isMergeChange,
  type PreparedJob,
  type StudioJobClient,
} from "./jobClient";
export {
  RENEW_EVERY_MS,
  runJobToEnd,
  runStudioJob,
  type JobPhase,
  type StudioJobResult,
} from "./runStudioJob";
export {
  BUILD_CANCELLED_MESSAGE,
  SERVER_BUILDS_OFF,
  SERVER_BUILD_POLL_MS,
  SERVER_BUILD_WAIT_MS,
  SERVE_POLL_MS,
  SERVE_WAIT_MS,
  buildProposal,
  buildProposalOnServer,
  withoutLockfiles,
  type BuiltProposal,
  type ServerBuildClient,
  type ProposalBuildClient,
  type ProposalBuildOutcome,
  type ProposalBuildStep,
} from "./buildProposal";
export { proposalProject } from "./proposalProject";
export {
  buildQuickPreview,
  clientFilesOf,
  type QuickPreviewOutcome,
} from "./buildQuickPreview";
