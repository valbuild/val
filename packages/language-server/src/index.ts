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
  severityFor,
  VAL_DIAGNOSTIC_SOURCE,
  VAL_DIAGNOSTIC_CODES,
  type ValDiagnosticCode,
  type ValDiagnosticData,
} from "./diagnostics";
export {
  findRegisteredModuleSpecifiers,
  isModuleRegistered,
} from "./valModulesRegistry";
export {
  createValCodeActions,
  isLocalFix,
  minimalTextEdit,
} from "./codeActions";
export {
  createValCompletions,
  resolveValCompletion,
  type ValCompletionItemData,
} from "./completions";
export {
  getValCompletionContext,
  type ValCompletionContext,
  type ValFileRefContext,
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
