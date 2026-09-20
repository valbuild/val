import { setValEnableCookieReader } from "../valEnableCookieBridge";
import { hasValEnableCookieOnServer } from "./valDraftMode";

// Fills the slot the root entry holds, so `initVal().isValEnabled()` works
// without the root entry importing TanStack's server module. See
// valEnableCookieBridge.ts.
setValEnableCookieReader(hasValEnableCookieOnServer);

export { initValServer } from "./initValServer";
/*
 * The default patch store, for a host that has to SHARE one.
 *
 * `initValServer` and `initValContent` build a Val server each, and each makes
 * its own store when none is given -- so a patch written through the API would
 * be invisible to a draft render. A host holding its own source constructs one
 * of these and passes it to both.
 */
export { InMemoryPatchStore, type ValPatchStore } from "@valbuild/server";
// The type the `http` option is named with. Exported from initValServer.ts
// but not from here, so the option could be passed and never annotated.
export type { ValHttpMode } from "./initValServer";
export { initValContent } from "./initValContent";
export {
  valDraftMode,
  hasValEnableCookieOnServer,
  VAL_DRAFT_MODE_COOKIE,
  type ValDraftMode,
} from "./valDraftMode";
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
