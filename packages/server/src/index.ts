export { createService, Service } from "./Service";
export { createValApiRouter, createValServer, safeReadGit } from "./ValRouter";
export { ValModuleLoader } from "./ValModuleLoader";
export { getCompilerOptions } from "./getCompilerOptions";
export { ValSourceFileHandler } from "./ValSourceFileHandler";
export { ValFSHost } from "./ValFSHost";
export type { IValFSHost } from "./ValFSHost";
export type { ValFS } from "./ValFS";
export { patchSourceFile } from "./patchValFile";
export { formatSyntaxErrorTree } from "./patch/ts/syntax";
// Locates the schema/source expressions of a `c.define(...)` module. Needed by
// editor tooling to map module paths back onto source positions.
export { analyzeValModule } from "./patch/ts/valModule";
export type { ValModuleAnalysis } from "./patch/ts/valModule";
export { createFixPatch } from "./createFixPatch";
export * from "./jwt";
export type { ValServer } from "./ValServer";
export { getSettings } from "./getSettings";
export {
  getPersonalAccessTokenPath,
  parsePersonalAccessTokenFile,
} from "./personalAccessTokens";
export { uploadRemoteFile } from "./uploadRemoteFile";
// Building blocks for editor tooling (see @valbuild/language-server). These are
// the pieces needed to reproduce a `val validate --fix` decision inside an
// editor, so that quick fixes take the same code path as the CLI and the Val UI
// rather than reimplementing metadata extraction and remote-ref checking.
export { extractImageMetadata, extractFileMetadata } from "./extractMetadata";
export { validateMetadata } from "./validateMetadata";
export { getValidationErrorFileRef } from "./getValidationErrorFileRef";
export {
  checkRemoteRef,
  downloadFileFromRemote,
  getCachedRemoteFileDir,
  getCachedRemoteFilePath,
} from "./checkRemoteRef";
// Re-exported rather than defined here: this used to be the server's own copy,
// and it disagreed with the Studio's. One implementation now lives in
// `@valbuild/core`, where both realms can reach it. Kept exported because it is
// public API of this package.
export { hasRemoteFileSchema } from "@valbuild/core";
export { getFileExt } from "./getFileExt";
export {
  evalValConfigFile,
  findAndEvalValConfigFile,
} from "./evalValConfigFile";
export {
  startValLogin,
  awaitValLoginConfirmation,
  persistPersonalAccessToken,
  ValLoginError,
  DEFAULT_LOGIN_HOST,
  DEFAULT_LOGIN_MAX_DURATION,
  DEFAULT_LOGIN_POLL_INTERVAL,
} from "./login";
export type {
  ValLoginErrorCode,
  ValLoginResult,
  ValLoginSession,
} from "./login";
export {
  createModulePathMap,
  createJsonEntryPathMap,
  getModulePathRange,
} from "./modulePathMap";
export { findJsonEntryFilePath } from "./jsonEntryLocation";
export { extractJsonValuesEntry } from "./extractJsonValuesEntry";
export type { ModulePathMap } from "./modulePathMap";
// Exposed for the CLI's `debug` command and the snapshot replay harness, which
// need to drive the same ops the app's api routes drive.
export { ValOpsFS } from "./ValOpsFS";
export { ValOpsHttp } from "./ValOpsHttp";
export { loadValModules } from "./loadValModules";
export { formatPatchSourceError } from "./ValOps";
export {
  compareWithCapturedReport,
  readCapturedReport,
  replaySnapshot,
} from "./debug/replaySnapshot";
export type { ReplayComparison, ReplayResult } from "./debug/replaySnapshot";
export type {
  OrderedPatches,
  PatchAnalysis,
  PatchSourceError,
  PreparedCommit,
} from "./ValOps";

/**
 * The local-dev patch store, exported so the CLI's debug tooling can read a
 * snapshot back with the same code the server uses rather than a second
 * implementation of the layout.
 */
export { readPatchStore, describePatchStoreProblems } from "./patchStore";
export type {
  PatchStoreEntry,
  PatchStoreProblem,
  ReadPatchStoreResult,
} from "./patchStore";
