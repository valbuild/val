import type { ValConfig, ValModules } from "@valbuild/core";
import {
  initValMcp as initValMcpCore,
  type ValMcp,
  type ValToolImpl,
  type ValOAuthConfig,
} from "@valbuild/mcp";
import { VERSION } from "../version";

/**
 * Val's tools over MCP, bound to Next.
 *
 * The MCP endpoint itself — the tools, the request guards, the access-token
 * verification — lives in `@valbuild/mcp`, which knows nothing about Next. All
 * that is left here is the one thing this package can answer and that one
 * cannot: which version of `@valbuild/next` is running, which
 * `initHandlerOptions` insists on before it will build a proxy-mode config.
 *
 * Kept exported from `@valbuild/next/server` because that is where it has
 * always been. New code can import `initValMcp` from `@valbuild/mcp` directly
 * and pass `versions: { next }` itself; there is no difference in behaviour.
 */
export function initValMcp(
  valModules: ValModules,
  config: ValConfig,
  opts?: {
    formatter?: (code: string, filePath: string) => string | Promise<string>;
    oauth?: ValOAuthConfig;
    /**
     * Tools to serve alongside the built-in ones — the image tool arrives this
     * way. See `createValImageTools` in `@valbuild/mcp`.
     */
    extraTools?: ValToolImpl[];
  },
): ValMcp {
  const nextVersion = VERSION;
  if (!nextVersion) {
    throw new Error("Could not get @valbuild/next package version");
  }
  return initValMcpCore(valModules, config, {
    ...opts,
    versions: { next: nextVersion },
  });
}
