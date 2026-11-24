import type { ValConfig, ValModules } from "@valbuild/core";
import type { ValMcp, ValToolImpl, ValOAuthConfig } from "@valbuild/mcp";
import { valMcpMetadataOf } from "@valbuild/mcp/metadata";
import { keptOnce } from "@valbuild/shared/internal";
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
 *
 * `@valbuild/mcp` is loaded by the first MCP request, not by this module: it
 * brings Val's whole server (the tools run against its data layer), and an
 * app's MCP route is imported by TanStack Start's route tree on every cold
 * start, so a static import made every visitor's first request pay for it. The
 * metadata document is the one part that must exist up front, and comes from
 * `@valbuild/mcp/metadata`, which is light.
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
  // Loaded by the first MCP request, and kept once it is -- the tools, never
  // the promise of them: on workerd a promise made by a request that has ended
  // fails every other request awaiting it. One that fails is loaded again.
  const loadMcp = keptOnce(
    (): Promise<ValMcp> =>
      import("@valbuild/mcp").then(({ initValMcp: initValMcpCore }) =>
        initValMcpCore(valModules, config, {
          ...opts,
          versions: { next: tanstackVersion },
        }),
      ),
  );
  return {
    valMcpMetadata: valMcpMetadataOf(opts?.oauth),
    async valMcpTools() {
      return (await loadMcp()).valMcpTools();
    },
    async valMcpAuthorize(request) {
      return (await loadMcp()).valMcpAuthorize(request);
    },
  };
}
