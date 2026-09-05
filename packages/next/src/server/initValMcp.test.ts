/**
 * @jest-environment node
 */
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { initVal } from "@valbuild/core";
import { initValMcp } from "./initValMcp";
import { clearValAccessTokenCache } from "./valAccessToken";

/**
 * What the MCP endpoint refuses, and why each refusal is not optional.
 *
 * These are the only checks between the public internet and a tool that can
 * rewrite a site's content, so each one is tested from the outside — through
 * `valMcpAuthorize`, the way a route calls it — rather than against the
 * predicates it is built from. A guard that is correct in isolation and
 * unreachable in the route is worth nothing.
 */

const { config } = initVal();

function mcp() {
  return initValMcp({ config, modules: [] }, config);
}

function request(headers: Record<string, string>): Request {
  return new Request("http://localhost:3000/api/mcp", {
    method: "POST",
    headers,
  });
}

/**
 * Run one case with `NODE_ENV` set, restoring it afterwards.
 *
 * Set through the env object rather than assigned, because `NODE_ENV` is typed
 * as a read-only literal union in a Next.js program.
 */
async function withNodeEnv<T>(value: string, fn: () => Promise<T>): Promise<T> {
  const previous = process.env.NODE_ENV;
  process.env["NODE_ENV"] = value;
  try {
    return await fn();
  } finally {
    process.env["NODE_ENV"] = previous;
  }
}

function httpModeEnv(): Record<string, string | undefined> {
  return {
    VAL_API_KEY: "app-api-key",
    VAL_SECRET: "0".repeat(32),
    VAL_GIT_COMMIT: "0".repeat(40),
    VAL_GIT_BRANCH: "main",
    VAL_PROJECT: "test/project",
  };
}

async function withEnv<T>(
  vars: Record<string, string | undefined>,
  fn: () => Promise<T>,
): Promise<T> {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

describe("local filesystem mode", () => {
  test("is refused outside development", async () => {
    // The one that matters most: fs mode has no credential and no backend, so a
    // deployed host serving this would be handing anyone who can reach the port
    // write access to the site's content.
    const res = await withNodeEnv("production", async () =>
      mcp().valMcpAuthorize(request({ host: "example.com" })),
    );

    expect(res.status).toBe("refused");
    if (res.status !== "refused") {
      return;
    }
    expect(res.response.status).toBe(403);
    await expect(res.response.json()).resolves.toEqual({
      error: expect.stringContaining("local filesystem mode"),
    });
  });

  test("is refused outside development even on localhost", async () => {
    // NODE_ENV is the check, not the hostname: a production build serving
    // localhost is still a build with no credential in the path.
    const res = await withNodeEnv("production", async () =>
      mcp().valMcpAuthorize(request({ host: "localhost:3000" })),
    );

    expect(res.status).toBe("refused");
  });

  test("serves a local request in development", async () => {
    const res = await withNodeEnv("development", async () =>
      mcp().valMcpAuthorize(request({ host: "localhost:3000" })),
    );

    // No credential: fs mode writes to the developer's own working tree, and
    // the registry refuses one rather than ignoring it.
    expect(res.status === "ok" && res.ctx).toEqual({
      auth: null,
      sessionId: null,
    });
  });

  test("refuses a request addressed to a non-loopback host", async () => {
    // DNS rebinding: a name the attacker controls resolves to 127.0.0.1, so the
    // request reaches the developer's own dev server while the browser sends
    // the attacker's Host. The listener being local is not evidence the request
    // is.
    const res = await withNodeEnv("development", async () =>
      mcp().valMcpAuthorize(request({ host: "rebind.example.com" })),
    );

    expect(res.status).toBe("refused");
    if (res.status !== "refused") {
      return;
    }
    expect(res.response.status).toBe(403);
  });

  test("X-Forwarded-Host cannot be used to fake a loopback host", async () => {
    // The forwarded header is client-controlled in a direct-to-app deployment,
    // so honouring it would hand an attacker the value this check is decided
    // on. `Host` is set by the browser from the URL and page script cannot
    // override it, which is the property the check depends on.
    const res = await withNodeEnv("development", async () =>
      mcp().valMcpAuthorize(
        request({
          host: "rebind.example.com",
          "x-forwarded-host": "localhost:3000",
        }),
      ),
    );

    expect(res.status).toBe("refused");
  });

  test("X-Forwarded-Host cannot be used to fake a same-origin request", async () => {
    const res = await withNodeEnv("development", async () =>
      mcp().valMcpAuthorize(
        request({
          host: "localhost:3000",
          origin: "https://evil.example.com",
          "x-forwarded-host": "evil.example.com",
        }),
      ),
    );

    expect(res.status).toBe("refused");
  });

  test("accepts the IPv6 loopback address, brackets and port included", async () => {
    const res = await withNodeEnv("development", async () =>
      mcp().valMcpAuthorize(request({ host: "[::1]:3000" })),
    );

    expect(res.status).toBe("ok");
  });
});

describe("cross-origin requests", () => {
  test("a browser's cross-origin Origin is refused", async () => {
    // A page on any origin can fetch a developer's localhost while the app is
    // running, and in fs mode that needs no credential.
    const res = await withNodeEnv("development", async () =>
      mcp().valMcpAuthorize(
        request({
          host: "localhost:3000",
          origin: "https://evil.example.com",
        }),
      ),
    );

    expect(res.status).toBe("refused");
    if (res.status !== "refused") {
      return;
    }
    expect(res.response.status).toBe(403);
    await expect(res.response.json()).resolves.toEqual({
      error: expect.stringContaining("cross-origin"),
    });
  });

  test("a same-origin Origin is allowed", async () => {
    const res = await withNodeEnv("development", async () =>
      mcp().valMcpAuthorize(
        request({ host: "localhost:3000", origin: "http://localhost:3000" }),
      ),
    );

    expect(res.status).toBe("ok");
  });

  test("an Origin on the same host but a different port is refused", async () => {
    // Same host, different origin: this is what a page served by another local
    // dev server looks like, and it is not the app.
    const res = await withNodeEnv("development", async () =>
      mcp().valMcpAuthorize(
        request({ host: "localhost:3000", origin: "http://localhost:5173" }),
      ),
    );

    expect(res.status).toBe("refused");
  });

  test("the opaque Origin, sent as the string null, is refused", async () => {
    // A sandboxed iframe or a file:// page. It cannot be compared to anything,
    // and "cannot be compared" has to mean refuse -- otherwise a page that
    // would fail the check passes it by arranging to have no origin.
    const res = await withNodeEnv("development", async () =>
      mcp().valMcpAuthorize(
        request({ host: "localhost:3000", origin: "null" }),
      ),
    );

    expect(res.status).toBe("refused");
    if (res.status !== "refused") {
      return;
    }
    expect(res.response.status).toBe(403);
  });

  test("no Origin at all is allowed", async () => {
    // The normal case: MCP clients are not browsers and send no Origin, so the
    // check has to cost them nothing.
    const res = await withNodeEnv("development", async () =>
      mcp().valMcpAuthorize(request({ host: "localhost:3000" })),
    );

    expect(res.status).toBe("ok");
  });
});

describe("credentials", () => {
  test("proxy mode with no oauth config refuses instead of relaying a token", async () => {
    const res = await withEnv(httpModeEnv(), async () =>
      withNodeEnv("production", async () =>
        mcp().valMcpAuthorize(
          request({
            host: "example.com",
            authorization: "Bearer pat-from-the-caller",
          }),
        ),
      ),
    );

    // This is the configuration that used to serve MCP to whoever presented a
    // bearer token: with no issuer the app has no key to check one against, so
    // it forwarded it unread and let the backend decide. The reasoning was
    // sound and the shape was not — it made an endpoint that authenticates
    // nobody a supported deployment. A credential the app cannot check is one
    // it cannot refuse either, which is the whole problem.
    expect(res.status).toBe("refused");
    if (res.status !== "refused") {
      throw new Error("expected a refusal");
    }
    expect(res.response.status).toBe(500);
    // 500 rather than 401: nothing the client can present will help, so
    // inviting it to authorize would send it round a loop. The app is
    // misconfigured, and the body has to say which config is missing or this
    // is a wall with no door.
    const body = await res.response.json();
    expect(body.error).toContain("oauth");
    expect(body.error).toContain("initValMcp");
  });

  test("the token is never echoed back in the refusal", async () => {
    // It cannot be checked, so it must not be repeated: an error body reaches
    // logs, terminals and bug reports, and a relayed credential in one is a
    // credential leaked to all three.
    const res = await withEnv(httpModeEnv(), async () =>
      withNodeEnv("production", async () =>
        mcp().valMcpAuthorize(
          request({
            host: "example.com",
            authorization: "Bearer pat-not-a-real-token",
          }),
        ),
      ),
    );

    if (res.status !== "refused") {
      throw new Error("expected a refusal");
    }
    expect(await res.response.text()).not.toContain("pat-not-a-real-token");
  });

  test("proxy mode with no oauth config refuses even with no token at all", async () => {
    // The refusal is about the app's configuration, not the request, so it
    // cannot be reached or avoided by choosing what to send.
    const res = await withEnv(httpModeEnv(), async () =>
      withNodeEnv("production", async () =>
        mcp().valMcpAuthorize(request({ host: "example.com" })),
      ),
    );

    expect(res.status).toBe("refused");
  });

  test("local filesystem mode refuses a token rather than ignoring it", async () => {
    // The developer did nothing dangerous — they left a credential in a client
    // config — but a token that reaches a working tree was checked by nothing,
    // and silence is what would let them believe otherwise. There is no `oauth`
    // config here, so this refusal has to happen at the endpoint: no verified
    // credential reaches `createValTools` for it to refuse.
    const res = await withNodeEnv("development", async () =>
      mcp().valMcpAuthorize(
        request({
          host: "localhost:3000",
          authorization: "Bearer pat-not-a-real-token",
        }),
      ),
    );

    if (res.status !== "refused") {
      throw new Error("expected a refusal");
    }
    expect(res.response.status).toBe(400);
    const body = await res.response.text();
    expect(body).toContain("local filesystem mode");
    expect(body).not.toContain("pat-not-a-real-token");
  });

  test("local filesystem mode still needs no config at all", async () => {
    // The one case that is genuinely credential-free, and it has to stay a
    // one-liner: there is no authorization server to point local development
    // at, and no backend for a token to mean anything to.
    const res = await withNodeEnv("development", async () =>
      mcp().valMcpAuthorize(request({ host: "localhost:3000" })),
    );

    expect(res.status === "ok" && res.ctx).toEqual({
      auth: null,
      sessionId: null,
    });
  });
});

describe("a call with no HTTP request", () => {
  test("is refused", async () => {
    // Reachable through a transport that carries no request. There is no
    // credential and no origin to check, which is exactly when failing open
    // would be worst.
    const res = await withNodeEnv("development", async () =>
      mcp().valMcpAuthorize(undefined),
    );

    expect(res.status).toBe("refused");
    if (res.status !== "refused") {
      return;
    }
    expect(res.response.status).toBe(401);
  });
});

/** An oauth-configured registry, plus what it takes to satisfy it. */
function oauthHarness(): {
  issuer: string;
  resource: string;
  fetchImpl: typeof fetch;
  signToken: (claims?: Record<string, unknown>) => string;
} {
  const issuer = "https://admin.val.build";
  const resource = "http://localhost:3000/api/mcp";
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  const jwk = publicKey.export({ format: "jwk" });
  const fetchImpl: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        keys: [{ ...jwk, kid: "k1", alg: "ES256", use: "sig" }],
      }),
      { status: 200 },
    );
  const b64 = (value: string): string =>
    Buffer.from(value).toString("base64url");
  return {
    issuer,
    resource,
    fetchImpl,
    signToken(claims = {}) {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const input = `${b64(
        JSON.stringify({ alg: "ES256", typ: "JWT", kid: "k1" }),
      )}.${b64(
        JSON.stringify({
          iss: issuer,
          aud: resource,
          sub: "profile-123",
          exp: nowSeconds + 600,
          scope: "val:read val:write",
          // The project the harness's env (`VAL_PROJECT`) configures, since
          // `initValMcp` checks the claim against Val's own config.
          val_project: "test/project",
          ...claims,
        }),
      )}`;
      const signature = cryptoSign("sha256", Buffer.from(input, "ascii"), {
        key: privateKey,
        dsaEncoding: "ieee-p1363",
      });
      return `${input}.${signature.toString("base64url")}`;
    },
  };
}

describe("oauth mode", () => {
  beforeEach(() => {
    // The key-set cache is keyed by the issuer's JWKS URL and outlives a
    // request by design — one issuer really does have one key set. These cases
    // all use the same issuer with different keys, so without this a later
    // token is checked against an earlier test's keys.
    clearValAccessTokenCache();
  });

  test("no config publishes no metadata document", async () => {
    // A project that has not been told where to authorize must not publish a
    // document claiming it knows. Leaving the config out is only viable in
    // local filesystem mode now — see the credentials cases — and there is
    // nothing to point such a project's clients at.
    expect(mcp().valMcpMetadata).toBeNull();
  });

  test("a request with no token is refused with a challenge that says where to authorize", async () => {
    const harness = oauthHarness();
    const res = await withEnv(httpModeEnv(), () =>
      initValMcp({ config, modules: [] }, config, {
        oauth: harness,
      }).valMcpAuthorize(request({})),
    );

    expect(res.status).toBe("refused");
    if (res.status !== "refused") {
      return;
    }
    expect(res.response.status).toBe(401);
    const challenge = res.response.headers.get("www-authenticate");
    // Without `resource_metadata` the client knows it needs a token and has no
    // way to find out from where: a dead end rather than a login.
    expect(challenge).toContain("resource_metadata=");
    expect(challenge).toContain("oauth-protected-resource");
    expect(challenge).toContain('error="invalid_request"');
  });

  test("a verified token becomes a verified profile, not a relayed credential", async () => {
    const harness = oauthHarness();
    const res = await withEnv(httpModeEnv(), () =>
      initValMcp({ config, modules: [] }, config, {
        oauth: harness,
      }).valMcpAuthorize(
        request({ authorization: `Bearer ${harness.signToken()}` }),
      ),
    );

    expect(res.status).toBe("ok");
    // The token itself is deliberately absent from the context: it was checked
    // here, so what travels onward is the identity it proved rather than the
    // credential.
    expect(res.status === "ok" && res.ctx.auth).toEqual({
      type: "verified-profile",
      profileId: "profile-123",
      scopes: ["val:read", "val:write"],
    });
  });

  test("a token approved for another project is refused, even at this address", async () => {
    const harness = oauthHarness();
    const res = await withEnv(httpModeEnv(), () =>
      initValMcp({ config, modules: [] }, config, {
        oauth: harness,
      }).valMcpAuthorize(
        request({
          authorization: `Bearer ${harness.signToken({
            val_project: "someone-else/site",
          })}`,
        }),
      ),
    );

    // Signed by the right issuer, minted for this exact address, unexpired —
    // and for somebody else's content. `aud` cannot see the difference, because
    // the address is the audience.
    expect(res.status).toBe("refused");
    if (res.status !== "refused") {
      return;
    }
    expect(res.response.status).toBe(401);
  });

  test("the project checked is Val's own config, not what the app passed", async () => {
    const harness = oauthHarness();
    const res = await withEnv(httpModeEnv(), () =>
      initValMcp({ config, modules: [] }, config, {
        // An app naming a project in its `oauth` block does not get to decide
        // which project this server serves: `val.config.ts` (here, VAL_PROJECT)
        // is the authority, and it says `test/project`.
        oauth: { ...harness, project: "someone-else/site" },
      }).valMcpAuthorize(
        request({ authorization: `Bearer ${harness.signToken()}` }),
      ),
    );

    expect(res.status).toBe("ok");
  });

  test("a forged token is refused with invalid_token", async () => {
    const harness = oauthHarness();
    const other = oauthHarness();
    const res = await withEnv(httpModeEnv(), () =>
      initValMcp({ config, modules: [] }, config, {
        oauth: harness,
      }).valMcpAuthorize(
        request({ authorization: `Bearer ${other.signToken()}` }),
      ),
    );

    expect(res.status).toBe("refused");
    if (res.status !== "refused") {
      return;
    }
    expect(res.response.status).toBe(401);
    expect(res.response.headers.get("www-authenticate")).toContain(
      'error="invalid_token"',
    );
  });

  test("a token with no read scope is 403, not 401", async () => {
    const harness = oauthHarness();
    const res = await withEnv(httpModeEnv(), () =>
      initValMcp({ config, modules: [] }, config, {
        oauth: harness,
      }).valMcpAuthorize(
        request({
          authorization: `Bearer ${harness.signToken({ scope: "" })}`,
        }),
      ),
    );

    expect(res.status).toBe("refused");
    if (res.status !== "refused") {
      return;
    }
    // 401 invites the client to authorize again; 403 tells it the grant is the
    // problem. Sending the wrong one puts a client in a loop.
    expect(res.response.status).toBe(403);
    expect(res.response.headers.get("www-authenticate")).toContain(
      'error="insufficient_scope"',
    );
  });

  test("configuring oauth publishes the metadata document", async () => {
    const harness = oauthHarness();
    const metadata = initValMcp({ config, modules: [] }, config, {
      oauth: harness,
    }).valMcpMetadata;

    expect(metadata).not.toBeNull();
    const body: unknown = await metadata?.GET(request({})).json();
    expect(body).toMatchObject({
      resource: harness.resource,
      authorization_servers: [harness.issuer],
    });
  });

  test("a deployed host is served without a loopback check", async () => {
    // The loopback requirement is specific to fs mode. In proxy mode the
    // verified token is the check, and the endpoint has to work on a real
    // hostname or it is useless — so the host must not be what refuses it.
    const harness = oauthHarness();
    const res = await withEnv(httpModeEnv(), () =>
      withNodeEnv("production", () =>
        initValMcp({ config, modules: [] }, config, {
          oauth: harness,
        }).valMcpAuthorize(
          request({
            host: "example.com",
            authorization: `Bearer ${harness.signToken()}`,
          }),
        ),
      ),
    );

    expect(res.status).toBe("ok");
  });

  test("a cross-origin request is still refused before the token is looked at", async () => {
    const harness = oauthHarness();
    const res = await withEnv(httpModeEnv(), () =>
      initValMcp({ config, modules: [] }, config, {
        oauth: harness,
      }).valMcpAuthorize(
        request({
          origin: "https://evil.example.com",
          authorization: `Bearer ${harness.signToken()}`,
        }),
      ),
    );

    // Order matters: a valid token does not buy a browser page the right to
    // drive this endpoint, so the origin check stays in front of verification.
    expect(res.status).toBe("refused");
    expect(res.status === "refused" && res.response.status).toBe(403);
  });
});
