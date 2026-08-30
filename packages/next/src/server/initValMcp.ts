import { Internal, ValConfig, ValModules } from "@valbuild/core";
import {
  createValTools,
  initHandlerOptions,
  type ValToolContext,
  type ValTools,
} from "@valbuild/server";
import { VERSION } from "../version";

/**
 * Val's tools over MCP, and the two checks that have to happen before a request
 * gets to them.
 *
 * Nothing here imports an MCP SDK. The app owns the transport — which SDK, which
 * route, which framework — and this owns the parts that must not be re-decided
 * per app: whether the request is allowed to reach the tools at all, and whose
 * credential it carries. `docs/plans/mcp.md` Part A has the reasoning; the short
 * version is that the SDK reorganised itself once already, and the security
 * checks should not move when it does again.
 */

export type ValMcpAuthorizationResult =
  | { status: "ok"; tools: ValTools; ctx: ValToolContext }
  | { status: "refused"; response: Response };

export type ValMcp = {
  /**
   * Check a request and, if it is allowed, hand back the tools and the context
   * to call them with.
   *
   * Call this per request — both halves are per request. Refusing early is the
   * point: a refused request must not reach the protocol layer, let alone a
   * tool.
   */
  valMcpAuthorize: (
    request: Request | undefined,
  ) => Promise<ValMcpAuthorizationResult>;
  /**
   * The registry itself, for listing tools at startup.
   *
   * Listing needs no credential — it reads no content — so registering tools
   * with an MCP server can happen once rather than per request.
   */
  valMcpTools: () => Promise<ValTools>;
};

export function initValMcp(
  valModules: ValModules,
  config: ValConfig,
  opts?: {
    formatter?: (code: string, filePath: string) => string | Promise<string>;
  },
): ValMcp {
  const route = "/api/val"; // TODO: get from config, as initValServer does
  const coreVersion = Internal.VERSION.core;
  if (!coreVersion) {
    throw new Error("Could not get @valbuild/core package version");
  }
  const nextVersion = VERSION;
  if (!nextVersion) {
    throw new Error("Could not get @valbuild/next package version");
  }

  // Resolved once at module-eval time, awaited per request. The no-op catch is
  // load bearing for the same reason it is in createValApiRouter: a config error
  // on a promise with no handler attached becomes an unhandledRejection and
  // takes the dev server down, and the error is reported per request below
  // anyway.
  const setupPromise = (async () => {
    const options = await initHandlerOptions(
      route,
      { ...config, versions: { core: coreVersion, next: nextVersion } },
      config,
    );
    return {
      mode: options.mode,
      tools: createValTools(valModules, {
        ...options,
        formatter: opts?.formatter,
      }),
    };
  })();
  setupPromise.catch(() => {
    // handled per request
  });

  return {
    async valMcpTools() {
      return (await setupPromise).tools;
    },

    async valMcpAuthorize(request) {
      let setup: Awaited<typeof setupPromise>;
      try {
        setup = await setupPromise;
      } catch (error) {
        return {
          status: "refused",
          response: jsonResponse(500, {
            error: "Val: could not start the Val MCP server",
            details: error instanceof Error ? error.message : String(error),
          }),
        };
      }

      if (request === undefined) {
        // No HTTP request means no credential and no origin to check, so there
        // is nothing to authorize. This is reachable through an SDK transport
        // that does not carry one (stdio), which is exactly the case where
        // failing open would be worst.
        return {
          status: "refused",
          response: jsonResponse(401, {
            error:
              "Val: this MCP server needs the HTTP request to authorize a call, and none was available.",
          }),
        };
      }

      const refusal = refuseUnsafeRequest(request, setup.mode);
      if (refusal) {
        return { status: "refused", response: refusal };
      }

      const pat = readBearerToken(request);
      return {
        status: "ok",
        tools: setup.tools,
        ctx: {
          // Passed through unverified, deliberately: this app is not the
          // authority on what a token may do, and the registry sends it to the
          // backend that is. See `docs/plans/mcp.md` D.2.
          auth: pat === null ? null : { pat },
          // Not the MCP session id. Val's patch `sessionId` names a Val AI
          // session, and putting an unrelated id in it would claim a
          // relationship that does not exist.
          sessionId: null,
        },
      };
    },
  };
}

/**
 * The two ways this route is dangerous, both refused here.
 *
 * 1. **Local filesystem mode outside development.** In fs mode there is no
 *    credential and no backend: the tools read and write the running process's
 *    own working tree, and every permission check Val has lives on the other
 *    side of a backend that is not in this path. Exposed on a deployed host,
 *    that is unauthenticated write access to the site's content for anyone who
 *    can reach the port. There is no configuration that makes it safe, so there
 *    is no flag to turn this off — a project that wants MCP in production wants
 *    proxy mode, where every call carries its caller's own token.
 *
 * 2. **A browser driving the local server.** A page on any origin can `fetch`
 *    `http://localhost:3000/api/mcp` while a developer has the app running, and
 *    with DNS rebinding it can do so with a `Host` of its own choosing. Neither
 *    needs a credential in fs mode. So a cross-origin `Origin` is refused, and
 *    in fs mode the request must actually be addressed to a loopback host.
 *
 * MCP clients are not browsers and send no `Origin`, so the check costs them
 * nothing.
 */
function refuseUnsafeRequest(
  request: Request,
  mode: "fs" | "http",
): Response | null {
  if (mode === "fs" && process.env.NODE_ENV !== "development") {
    return jsonResponse(403, {
      error:
        "Val: the MCP endpoint is disabled. This project is running in local filesystem mode, where MCP calls are unauthenticated and write directly to the working tree, so it is only served in development. Configure Val for proxy mode to use MCP on a deployed host.",
    });
  }

  const host = requestHost(request);
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== "null") {
    const originHost = hostOf(origin);
    if (originHost === null || host === null || originHost !== host) {
      return jsonResponse(403, {
        error: `Val: refusing a cross-origin MCP request from ${JSON.stringify(
          origin,
        )}. MCP clients do not send an Origin header; a browser does.`,
      });
    }
  }

  if (mode === "fs") {
    const hostname = host === null ? null : hostnameOf(host);
    if (hostname === null || !LOOPBACK_HOSTNAMES.has(hostname)) {
      return jsonResponse(403, {
        error: `Val: refusing an MCP request addressed to ${JSON.stringify(
          host ?? "an unknown host",
        )}. In local filesystem mode this endpoint only answers on localhost, because a name that resolves to 127.0.0.1 is how a web page reaches a developer's own machine.`,
      });
    }
  }

  return null;
}

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Which host the request was addressed to, as `hostname:port`.
 *
 * `X-Forwarded-Host` wins where it is set, because behind a proxy `Host` is the
 * internal name and the forwarded one is what the client actually asked for.
 * Note that a client can send either header, which is fine for the loopback
 * check — a browser cannot forge `Host`, and `X-Forwarded-Host` only ever
 * relaxes the check for a request that already reached a loopback listener.
 */
function requestHost(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-host");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim().toLowerCase() ?? null;
  }
  const host = request.headers.get("host");
  if (host) {
    return host.trim().toLowerCase();
  }
  // Last resort: the URL the framework saw.
  try {
    return new URL(request.url).host.toLowerCase();
  } catch {
    return null;
  }
}

function hostOf(origin: string): string | null {
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return null;
  }
}

/** Strips the port, keeping IPv6 brackets — `[::1]:3000` is hostname `[::1]`. */
function hostnameOf(host: string): string {
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end === -1 ? host : host.slice(0, end + 1);
  }
  const colon = host.indexOf(":");
  return colon === -1 ? host : host.slice(0, colon);
}

function readBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) {
    return null;
  }
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  return token ? token : null;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
