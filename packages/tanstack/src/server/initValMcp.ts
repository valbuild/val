import type { ValConfig, ValModules } from "@valbuild/core";
import {
  initValMcp as initValMcpCore,
  type ValMcp,
  type ValToolImpl,
  type ValOAuthConfig,
} from "@valbuild/mcp";
import { VERSION } from "../version";

/**
 * Val's tools over MCP, bound to this package.
 *
 * The MCP endpoint itself — the tools, the request guards, the access-token
 * verification — lives in `@valbuild/mcp`, which knows nothing about any
 * framework. All that is left here is the one thing this package can answer and
 * that one cannot: which version of `@valbuild/tanstack` is running, which
 * `initHandlerOptions` insists on before it will build a proxy-mode config.
 *
 * The version goes in the `next` field because that is the field name in the
 * wire contract; see `initValServer`.
 */
export function initValMcp(
  valModules: ValModules,
  config: ValConfig,
  opts?: {
    formatter?: (code: string, filePath: string) => string | Promise<string>;
    /**
     * Where to authorize, and what audience to expect. Required for proxy
     * mode; see `initValMcp` in `@valbuild/mcp` for what omitting it means.
     */
    oauth?: ValOAuthConfig;
    /**
     * Tools to serve alongside the built-in ones — the image tool arrives this
     * way. See `createValImageTools` in `@valbuild/mcp`.
     */
    extraTools?: ValToolImpl[];
  },
): ValMcp {
  const tanstackVersion = VERSION;
  if (!tanstackVersion) {
    throw new Error("Could not get @valbuild/tanstack package version");
  }
  return initValMcpCore(valModules, config, {
    ...opts,
    versions: { next: tanstackVersion },
  });
}
