import { setValEnableCookieReader } from "../valEnableCookieBridge";
import { hasValEnableCookieOnServer } from "./valDraftMode";

// Fills the slot the root entry holds, so `initVal().isValEnabled()` works
// without the root entry importing TanStack's server module. See
// valEnableCookieBridge.ts.
setValEnableCookieReader(hasValEnableCookieOnServer);

export { initValServer } from "./initValServer";
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
