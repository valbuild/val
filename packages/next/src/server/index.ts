import "server-only";
export { initValServer } from "./initValServer";
/*
 * The default patch store, for a host that has to SHARE one.
 *
 * `initValServer` and `initValRsc` build a Val server each, and each makes its
 * own store when none is given -- so a patch written through the API would be
 * invisible to a draft render. A host holding its own source constructs one of
 * these and passes it to both.
 */
export { InMemoryPatchStore, type ValPatchStore } from "@valbuild/server";
export { initValMcp } from "./initValMcp";
// Re-exported so an app that mounts the MCP endpoint through this package does
// not also have to depend on `@valbuild/mcp` for the types it hands back.
export type {
  ValMcp,
  ValMcpAuthorizationResult,
  ValMcpMetadataHandlers,
  ValOAuthConfig,
  ValToolImpl,
} from "@valbuild/mcp";
