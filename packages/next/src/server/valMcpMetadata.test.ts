import { createValMcpMetadata, wwwAuthenticate } from "./valMcpMetadata";
import type { ValOAuthConfig } from "./valAccessToken";

/**
 * The discovery document and the challenge that points at it.
 *
 * Both are small, and both are the kind of small that fails silently: a missing
 * `resource_metadata` parameter or an unanswered CORS preflight presents to the
 * user as "this connector cannot authorize", with nothing anywhere to say why.
 */

const OAUTH: ValOAuthConfig = {
  issuer: "https://admin.val.build",
  resource: "https://acme.example.com/api/mcp",
};
const SCOPES = ["val:read", "val:write"];

describe("createValMcpMetadata", () => {
  test("names the resource and its authorization server", async () => {
    const metadata = createValMcpMetadata(OAUTH, SCOPES);

    const res = metadata.GET(new Request(OAUTH.resource));
    const body: unknown = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      // The resource identifier a client sends as `resource` and gets back in
      // `aud`. Same string the verifier checks against, so the two cannot
      // drift.
      resource: "https://acme.example.com/api/mcp",
      authorization_servers: ["https://admin.val.build"],
      scopes_supported: ["val:read", "val:write"],
      bearer_methods_supported: ["header"],
    });
  });

  test("is readable cross-origin, and answers the preflight", () => {
    const metadata = createValMcpMetadata(OAUTH, SCOPES);

    const get = metadata.GET(new Request(OAUTH.resource));
    expect(get.headers.get("access-control-allow-origin")).toBe("*");

    const preflight = metadata.OPTIONS(
      new Request(OAUTH.resource, { method: "OPTIONS" }),
    );
    // Without an answer here the document is never read by a browser-based
    // client, and the failure appears at authorization rather than at discovery.
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
    expect(preflight.headers.get("access-control-allow-methods")).toContain(
      "GET",
    );
  });

  test("does not allow credentials alongside the wildcard origin", () => {
    const metadata = createValMcpMetadata(OAUTH, SCOPES);

    const res = metadata.GET(new Request(OAUTH.resource));

    // `*` with `Allow-Credentials: true` is rejected by browsers outright, so
    // pairing them would break the very clients this document exists for. The
    // document is public and is never fetched with credentials.
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });
});

describe("wwwAuthenticate", () => {
  test("points at the resource metadata document", () => {
    const header = wwwAuthenticate(OAUTH, SCOPES);

    // The load-bearing parameter: it is how a client that has never seen this
    // server finds out where to authorize. A 401 without it is a dead end.
    expect(header).toContain(
      'resource_metadata="https://acme.example.com/.well-known/oauth-protected-resource"',
    );
    expect(header).toContain('scope="val:read val:write"');
    expect(header.startsWith("Bearer ")).toBe(true);
  });

  test("carries the error code and description when there is one", () => {
    const header = wwwAuthenticate(OAUTH, SCOPES, {
      error: "invalid_token",
      description: "The access token has expired.",
    });

    expect(header).toContain('error="invalid_token"');
    expect(header).toContain(
      'error_description="The access token has expired."',
    );
  });

  test("cannot be broken out of by a newline in the description", () => {
    const header = wwwAuthenticate(OAUTH, SCOPES, {
      error: "invalid_token",
      description: "line one\r\nX-Injected: yes",
    });

    // Response splitting: a CR or LF ends the header line, so an
    // attacker-influenced description could add a header of its own or a whole
    // second response. Nothing interpolates request data into these strings
    // today — this is what keeps that from becoming a vulnerability when
    // something does.
    expect(header).not.toContain("\r");
    expect(header).not.toContain("\n");
    expect(header).toContain("X-Injected: yes");
    expect(header.split("\n")).toHaveLength(1);
  });

  test("cannot be broken out of by a quote in the description", () => {
    const header = wwwAuthenticate(OAUTH, SCOPES, {
      error: "invalid_token",
      description: 'unexpected " and \\ characters',
    });

    // A quote would end the parameter early and produce a header some clients
    // reject outright — so the value is stripped rather than trusted to be
    // well-behaved.
    expect(header).toContain('error_description="unexpected  and  characters"');
    // Two quotes per parameter and four parameters: resource_metadata, scope,
    // error, error_description. Anything else means a value closed early.
    expect(header.match(/"/g)?.length).toBe(8);
  });
});
