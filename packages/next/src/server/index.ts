import "server-only";
export { initValServer } from "./initValServer";
export { initValMcp } from "./initValMcp";
// The project's own formatting, as one function. Re-exported so an app does not
// need a direct dependency on `@valbuild/server` to pass a correct `formatter`,
// and so the app and `val validate --fix` format identically — they run this
// same code. See `createPrettierFormatter` for why `prettier.format(code, {
// filepath })` on its own is not enough.
export {
  createPrettierFormatter,
  type PrettierLike,
  type ValFormatter,
} from "@valbuild/server";
// The external-record adapter contract, so the `server-only` file that holds a
// project's adapters imports from the same package `initValServer` does. An
// app does not otherwise depend on `@valbuild/server`.
export { defineExternal, ok, err } from "@valbuild/server";
export type {
  AdapterFor,
  ExternalAuthor,
  ExternalCtx,
  ExternalDefinition,
  ExternalFile,
  ExternalIssue,
  ExternalKeyPage,
  ExternalOptionFor,
  ExternalRecords,
  ExternalResult,
  ExternalSearchHit,
  ExternalSearchPage,
  ExternalSort,
  ItemOfModule,
  Returns,
} from "@valbuild/server";
// Re-exported so an app that mounts the MCP endpoint through this package does
// not also have to depend on `@valbuild/mcp` for the types it hands back.
export type {
  ValMcp,
  ValMcpAuthorizationResult,
  ValMcpMetadataHandlers,
  ValOAuthConfig,
  ValToolImpl,
} from "@valbuild/mcp";
