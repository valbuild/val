/**
 * Val's content tools, and the checks that decide whether a request may reach
 * them, for hosts that speak the Model Context Protocol.
 *
 * Nothing in this package imports an MCP SDK. The app owns the transport —
 * which SDK, which route, which framework — and this owns the parts that must
 * not be re-decided per app: the tools themselves, whether a request is allowed
 * to reach them at all, and whose credential it carries.
 * `docs/plans/mcp.md` Part A has the reasoning; the short version is that the
 * SDK reorganised itself once already, and the security checks should not move
 * when it does again.
 */

// The registry, and the whole of what a host needs to drive it.
export { createValTools } from "./tools";
export type { ValToolsOptions } from "./tools";
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
} from "./tools";

// The scope names and the one legitimate way to brand a verified subject: a
// host that verifies an access token itself needs both, and neither should be
// re-spelled at the edge where getting it wrong is a silent authorization bug.
export {
  VAL_SCOPE_READ,
  VAL_SCOPE_WRITE,
  authorIdFromVerifiedSubject,
} from "./tools";

// Writing a tool of your own, and saving what it builds through the same
// validate-then-write path the built-in write tools use.
export { defineTool, err, ok, savePatch } from "./tools";
export type {
  OnInvalid,
  SavePatchData,
  SavePatchResult,
  UploadPatchFiles,
  ValToolDeps,
  ValToolImpl,
  ValToolState,
} from "./tools";

// The image tool. Separate from the rest because it needs an image library the
// host installs — see `@valbuild/mcp/sharp`.
export { createValImageTools } from "./images";
export type {
  ValImageProcessor,
  ValImageProcessorResult,
  ValImageEncodeRequest,
} from "./images";

// The endpoint: authorize a request, then hand back the tools to answer it.
export { initValMcp } from "./initValMcp";
export type { ValMcp, ValMcpAuthorizationResult } from "./initValMcp";
export type { ValOAuthConfig } from "./valAccessToken";
export type { ValMcpMetadataHandlers } from "./valMcpMetadata";
