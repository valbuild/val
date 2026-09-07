export { createValTools, type ValToolsOptions } from "./createValTools";
// How a tool is written. Exported because the image tool is built by the host
// and handed back through `extraTools`, so `defineTool` is part of this
// package's surface rather than an internal convenience.
export { defineTool, err, ok } from "./defineTool";
export type { ValToolDeps, ValToolImpl, ValToolState } from "./defineTool";
export { savePatch, mintPatchId, deriveParentRef } from "./writePath";
export type {
  OnInvalid,
  SavePatchData,
  SavePatchResult,
  UploadPatchFiles,
} from "./writePath";
export {
  VAL_SCOPE_READ,
  VAL_SCOPE_WRITE,
  authorIdFromVerifiedSubject,
} from "./types";
export type {
  ValScope,
  ValToolAuth,
  ValToolContext,
  ValToolDefinition,
  ValToolDefinitionJson,
  ValToolError,
  ValToolErrorCode,
  ValToolResult,
  ValTools,
} from "./types";
