export { createService, Service } from "./Service";
export { createValApiRouter, createValServer, safeReadGit } from "./ValRouter";
// Val's tools, over ValOps rather than the Studio's browser stores — so an MCP
// server, a stdio transport or anything else can drive Val content without a
// browser. Nothing under `tools/` imports an MCP SDK, and the host that does
// adapts `ValToolResult` at its own edge.
export { createValTools } from "./tools";
export type {
  ValToolContext,
  ValToolDefinition,
  ValToolDefinitionJson,
  ValToolErrorCode,
  ValToolResult,
  ValTools,
  ValToolsOptions,
} from "./tools";
// Exported for a host that has to build the same config the API router builds:
// two copies of this decision drift, and a registry that thinks it is in fs mode
// while the Studio thinks it is in proxy mode reads different content from the
// same project.
export { initHandlerOptions, createValOps } from "./valServerConfig";
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
// The precondition layer behind `val validate --fix`: read the file, check it is
// on disk, extract metadata, pick a bucket, upload or download the bytes. The
// CLI drove this alone until the language server needed the same fixes; keeping
// one copy here is what stops an editor fix drifting from a CLI fix.
export {
  fixHandlers,
  currentFixHandlers,
  createDefaultValFSHost,
  handleFileMetadata,
  handleRemoteFileUpload,
  handleRemoteGalleryFileUpload,
  handleRemoteFileDownload,
  handleRemoteFileCheck,
  handleUniqueFolderCheck,
  handleCheckAllFiles,
  handleJsonValuesExtractEntry,
} from "./fixHandlers";
export type {
  FixHandler,
  FixHandlerContext,
  FixHandlerResult,
  IValRemote,
  ValidationEvent,
  ValidationError,
  ValModule,
} from "./fixHandlers";
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
// The two halves of routing a patch op into a `.jsonValues()` entry's own
// `*.val.json`. Exported because every writer of entry content needs them and
// there must not be a second implementation: the Studio's publish
// (`ValOps.prepare`), `val validate --fix` (`Service.patch`) and the editor's
// quick fixes all classify and rebase the same way, or they disagree about
// which file an edit belongs in.
export { classifyJsonValuesOp, rebaseContentOp } from "./patch/jsonValuesPatch";
export type { JsonValuesOpClass } from "./patch/jsonValuesPatch";
export { extractJsonValuesEntry } from "./extractJsonValuesEntry";
export type { ModulePathMap } from "./modulePathMap";
// Exposed for the CLI's `debug` command and the snapshot replay harness, which
// need to drive the same ops the app's api routes drive.
export { ValOpsFS } from "./ValOpsFS";
export { ValOpsHttp } from "./ValOpsHttp";
export { loadValModules, createValModuleFileInspector } from "./loadValModules";
export type { ValModuleFileInspection } from "./loadValModules";
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
