export { main, createValLanguageServer, type ValSession } from "./server";
export { getLanguageServerVersion } from "./version";
export {
  createEditorFsHost,
  mapOpenDocuments,
  type OpenDocuments,
} from "./EditorFsHost";
export {
  createValProject,
  defaultCoreResolver,
  type CoreResolver,
  type ValProject,
  type ValProjectInitError,
  type ValModuleContent,
} from "./ValProject";
export {
  createValDiagnostics,
  createMissingModuleDiagnostic,
  createProjectErrorDiagnostic,
  severityFor,
  VAL_DIAGNOSTIC_SOURCE,
  VAL_DIAGNOSTIC_CODES,
  type ValDiagnosticCode,
  type ValDiagnosticData,
  resolveGalleryChecks,
  isGalleryCheckFix,
  galleryCheckKey,
  type GalleryCheckFinding,
  type GalleryCheckVerdict,
  galleryMembershipAt,
  type GalleryMembership,
} from "./diagnostics";
export {
  findRegisteredModuleSpecifiers,
  isModuleRegistered,
} from "./valModulesRegistry";
export {
  createValCodeActions,
  createMissingModuleCodeAction,
  adjudicateGalleryCheck,
  isLocalFix,
} from "./codeActions";
export { minimalTextEdit } from "./textEdit";
export {
  createValCommands,
  isRemoteFix,
  valCommandNames,
  readPersonalAccessToken,
  REMOTE_FIX_COMMANDS,
  REMOTE_FIX_TITLES,
  VAL_LOGIN_COMMAND,
  VAL_UPLOAD_REMOTE_COMMAND,
  VAL_DOWNLOAD_REMOTE_COMMAND,
  type RemoteFixCommandArgs,
} from "./commands";
export {
  findValModulesInsertion,
  valModuleSpecifier,
  valModulesEntryText,
} from "./valModulesRegistry";
export {
  canRenameFiles,
  createGalleryMembershipActions,
  findRecordInsertion,
} from "./galleryFixes";
export {
  createValCompletions,
  resolveValCompletion,
  type ValCompletionItemData,
} from "./completions";
export {
  getValCompletionContext,
  findMediaPathObject,
  MEDIA_METADATA_KEYS,
  type MediaMetadataKey,
  type MediaPathObject,
  type ValCompletionContext,
  type ValStringValueContext,
} from "./completionContext";
export {
  createPublicValFiles,
  DEFAULT_FILES_DIRECTORY,
  type PublicValFile,
  type PublicValFiles,
} from "./publicValFiles";
export {
  createModulePathMap,
  findModulePathAtPosition,
  getModulePathRange,
  type ModulePathMap,
  type ModulePathRange,
  type ModulePosition,
} from "./modulePathMap";
export { isValModuleUri, pathToUri, toModuleFilePath, uriToPath } from "./uri";
export {
  PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  VAL_FEATURES,
  VAL_PICK_REQUEST,
  VAL_INPUT_REQUEST,
  negotiateProtocolVersion,
  type ProtocolVersionRange,
  type ProtocolNegotiationResult,
  type ValClientCapabilities,
  type ValClientInfo,
  type ValEnvOverrides,
  type ValFeature,
  type ValInitializationOptions,
  type ValInputParams,
  type ValInputResult,
  type ValPickItem,
  type ValPickParams,
  type ValPickResult,
  type ValServerCapabilities,
} from "./protocol";
