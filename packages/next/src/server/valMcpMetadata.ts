import type { ValOAuthConfig } from "./valAccessToken";

/**
 * The one document an MCP client needs before it can authorize: RFC 9728
 * Protected Resource Metadata, served by the *resource* server.
 *
 * This is how a client discovers where to authorize. It asks the resource — this
 * app — and the resource names its authorization server. Which is why this
 * belongs here and the RFC 8414 *authorization server* metadata does not: that
 * document lives at the issuer, describes the issuer's own endpoints, and is
 * served by the issuer. An app serving a copy would be asserting the issuer's
 * configuration on its behalf, and would be wrong the moment the issuer changed
 * anything.
 *
 * The flow, so the split reads as a whole:
 *
 * 1. client → `{app}/api/mcp` with no token → `401` naming this document
 * 2. client → `{app}/.well-known/oauth-protected-resource` → the issuer
 * 3. client → `{issuer}/.well-known/oauth-authorization-server` → endpoints
 * 4. client → issuer's `/authorize`, then `/token`
 * 5. client → `{app}/api/mcp` with the token
 */

export type ValMcpMetadataHandlers = {
  /** The metadata document. */
  GET: (request: Request) => Response;
  /**
   * The CORS preflight.
   *
   * Required rather than defensive: the metadata document is fetched
   * cross-origin by browser-based clients, and without a preflight answer the
   * fetch fails before the document is read — which presents as "this connector
   * cannot authorize" with nothing in any log to explain it.
   */
  OPTIONS: (request: Request) => Response;
};

const CORS_HEADERS: Record<string, string> = {
  // The document is public and contains no secrets — it exists to be read by
  // clients whose origin we cannot know in advance, so `*` is the correct value
  // rather than a lazy one. Note there is no `Access-Control-Allow-Credentials`:
  // with it, `*` would be rejected by browsers, and this document is never
  // fetched with credentials.
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, MCP-Protocol-Version",
  "Access-Control-Max-Age": "3600",
};

export function createValMcpMetadata(
  oauth: ValOAuthConfig,
  scopesSupported: string[],
): ValMcpMetadataHandlers {
  const document = {
    // The resource identifier, which MUST be the value clients send as
    // `resource` and the value that arrives back in `aud`. Same string as the
    // audience this app verifies against — one value, so the two cannot drift.
    resource: oauth.resource,
    authorization_servers: [oauth.issuer],
    scopes_supported: scopesSupported,
    bearer_methods_supported: ["header"],
  };
  const body = JSON.stringify(document);

  return {
    GET(): Response {
      return new Response(body, {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          // Cacheable: it changes only when the app is reconfigured, and a
          // client that re-reads it on every authorization costs a round trip
          // for nothing.
          "Cache-Control": "public, max-age=3600",
          ...CORS_HEADERS,
        },
      });
    },
    OPTIONS(): Response {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    },
  };
}

/**
 * The `WWW-Authenticate` value for a refusal (RFC 6750 section 3, RFC 9728
 * section 5.1).
 *
 * `resource_metadata` is the load-bearing parameter: it is how a client that has
 * never seen this server learns where to authorize. A `401` without it is a dead
 * end — the client knows it needs a token and has no way to find out from where.
 */
export function wwwAuthenticate(
  oauth: ValOAuthConfig,
  scopesSupported: string[],
  refusal?: { error: string; description: string },
): string {
  const metadataUrl = new URL(
    "/.well-known/oauth-protected-resource",
    oauth.resource,
  ).toString();
  const params = [
    `resource_metadata="${metadataUrl}"`,
    `scope="${scopesSupported.join(" ")}"`,
  ];
  if (refusal) {
    params.push(`error="${refusal.error}"`);
    params.push(`error_description="${headerSafe(refusal.description)}"`);
  }
  return `Bearer ${params.join(", ")}`;
}

/**
 * Make a string safe to put inside a quoted header parameter.
 *
 * Three classes go, and the third is the one that matters most:
 *
 * - a **quote** would close the parameter early;
 * - a **backslash** would start an escape the rest of the value does not
 *   finish;
 * - a **CR or LF** would end the header line, which is response splitting — an
 *   attacker-influenced description could inject a header of their own, or a
 *   whole second response.
 *
 * The descriptions passed here today are all literals from this package and
 * contain none of it. That is a property of today's callers rather than of the
 * type, and this function exists so it stays true when a future one interpolates
 * something from a request.
 */
function headerSafe(value: string): string {
  // eslint-disable-next-line no-control-regex -- the point is to remove them
  return value.replace(/["\\]/g, "").replace(/[\u0000-\u001f\u007f]/g, " ");
}
