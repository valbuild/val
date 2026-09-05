import {
  createPrivateKey,
  generateKeyPairSync,
  sign as cryptoSign,
} from "node:crypto";
import {
  clearValAccessTokenCache,
  verifyValAccessToken,
  type ValOAuthConfig,
} from "./valAccessToken";

/**
 * Access-token verification, exercised against real ES256 keypairs and a real
 * JWKS document. Only the network is faked.
 *
 * That is deliberate rather than thorough-for-its-own-sake: every interesting
 * case here is one where a *wrong* verifier says yes — a token signed by a key
 * the issuer does not publish, a token minted for another deployment, an
 * expired one, one that nominated its own algorithm. A stubbed verifier cannot
 * fail those the way the real one can, so the keys and signatures are genuine
 * and the assertions are about refusals.
 */

const ISSUER = "https://admin.val.build";
const RESOURCE = "https://acme.example.com/api/mcp";

type Keys = { privateKeyPem: string; publicJwk: Record<string, unknown> };

function makeKeys(kid: string = "test-key"): Keys {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  const jwk = publicKey.export({ format: "jwk" });
  return {
    privateKeyPem: privateKey
      .export({ format: "pem", type: "pkcs8" })
      .toString(),
    publicJwk: { ...jwk, kid, alg: "ES256", use: "sig" },
  };
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

function signToken(
  keys: Keys,
  claims: Record<string, unknown> = {},
  header: Record<string, unknown> = {},
): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const fullHeader = { alg: "ES256", typ: "JWT", kid: "test-key", ...header };
  const fullClaims = {
    iss: ISSUER,
    aud: RESOURCE,
    sub: "profile-123",
    iat: nowSeconds,
    exp: nowSeconds + 15 * 60,
    ...claims,
  };
  const signingInput = `${base64url(JSON.stringify(fullHeader))}.${base64url(
    JSON.stringify(fullClaims),
  )}`;
  const signature = cryptoSign("sha256", Buffer.from(signingInput, "ascii"), {
    key: createPrivateKey(keys.privateKeyPem),
    dsaEncoding: "ieee-p1363",
  });
  return `${signingInput}.${signature.toString("base64url")}`;
}

/**
 * A `fetch` that serves one JWKS, counts how often it was asked, and can have
 * the document swapped underneath it.
 *
 * The swap is what makes the rotation cases testable at all: publishing a new
 * key is something the issuer does between two calls to this server, and the
 * question is whether the second call notices.
 */
function serveJwks(keys: Record<string, unknown>[]): {
  fetchImpl: typeof fetch;
  calls: () => number;
  publish: (keys: Record<string, unknown>[]) => void;
  hold: () => () => void;
  breakIssuer: () => void;
} {
  let calls = 0;
  let published = keys;
  let gate: Promise<void> | null = null;
  let broken = false;
  const fetchImpl: typeof fetch = async (input) => {
    calls++;
    const url = typeof input === "string" ? input : String(input);
    if (!url.endsWith("/.well-known/jwks.json")) {
      return new Response("not found", { status: 404 });
    }
    if (gate) {
      await gate;
    }
    if (broken) {
      return new Response("boom", { status: 500 });
    }
    return new Response(JSON.stringify({ keys: published }), { status: 200 });
  };
  return {
    fetchImpl,
    // Counted before the gate, so this is "fetches started", which is what the
    // issuer would see.
    calls: () => calls,
    publish: (next) => {
      published = next;
    },
    /**
     * Hold every fetch open until the returned function is called.
     *
     * The only way to test what happens *while* a fetch is in flight: without
     * it the mock resolves in a microtask and there is no window for a second
     * request to arrive in.
     */
    hold: () => {
      let open = (): void => {};
      gate = new Promise<void>((resolve) => {
        open = resolve;
      });
      return () => {
        gate = null;
        open();
      };
    },
    /** Every fetch from now on fails, as a flaky issuer would. */
    breakIssuer: () => {
      broken = true;
    },
  };
}

const PROJECT = "acme/site";

function oauth(fetchImpl: typeof fetch): ValOAuthConfig {
  return { issuer: ISSUER, resource: RESOURCE, fetchImpl };
}

/** The same config as an app that knows which project it serves. */
function oauthForProject(
  fetchImpl: typeof fetch,
  project: string = PROJECT,
): ValOAuthConfig {
  return { issuer: ISSUER, resource: RESOURCE, project, fetchImpl };
}

function request(token?: string): Request {
  return new Request(RESOURCE, {
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  });
}

beforeEach(() => {
  // The key-set cache is per issuer and outlives a request by design, so it has
  // to be cleared between tests: otherwise a later test verifies against an
  // earlier test's keys and passes for the wrong reason.
  clearValAccessTokenCache();
});

describe("verifyValAccessToken", () => {
  test("accepts a well-formed token and reports the verified profile", async () => {
    const keys = makeKeys();
    const jwks = serveJwks([keys.publicJwk]);
    const token = signToken(keys, { scope: "val:read val:write" });

    const res = await verifyValAccessToken(
      request(token),
      oauth(jwks.fetchImpl),
    );

    expect(res).toEqual({
      status: "ok",
      auth: {
        type: "verified-profile",
        profileId: "profile-123",
        scopes: ["val:read", "val:write"],
      },
    });
  });

  test("distinguishes no token from a bad one", async () => {
    const keys = makeKeys();
    const jwks = serveJwks([keys.publicJwk]);

    const missing = await verifyValAccessToken(
      request(),
      oauth(jwks.fetchImpl),
    );
    // `invalid_request`, not `invalid_token`: a client that has not authorized
    // yet must be invited to, and RFC 6750 gives the two different codes.
    expect(missing).toMatchObject({
      status: "refused",
      error: "invalid_request",
    });

    const garbage = await verifyValAccessToken(
      request("not-a-jwt"),
      oauth(jwks.fetchImpl),
    );
    expect(garbage).toMatchObject({
      status: "refused",
      error: "invalid_token",
    });
  });

  test("refuses a token signed by a key the issuer does not publish", async () => {
    const ours = makeKeys();
    const theirs = makeKeys();
    // The issuer publishes our key; the token is signed with another. This is
    // the forged-token case, and the one a careless verifier waves through.
    const jwks = serveJwks([ours.publicJwk]);
    const token = signToken(theirs, { scope: "val:read" });

    const res = await verifyValAccessToken(
      request(token),
      oauth(jwks.fetchImpl),
    );

    expect(res).toMatchObject({ status: "refused", error: "invalid_token" });
  });

  test("refuses a token whose payload was changed after signing", async () => {
    const keys = makeKeys();
    const jwks = serveJwks([keys.publicJwk]);
    const token = signToken(keys, { scope: "val:read" });
    const [header, , signature] = token.split(".");
    const tampered = `${header}.${base64url(
      JSON.stringify({
        iss: ISSUER,
        aud: RESOURCE,
        sub: "somebody-else",
        exp: Math.floor(Date.now() / 1000) + 600,
        scope: "val:read val:write",
      }),
    )}.${signature}`;

    const res = await verifyValAccessToken(
      request(tampered),
      oauth(jwks.fetchImpl),
    );

    // The point of verifying before reading: a swapped `sub` would otherwise
    // attribute someone else's edits, and a swapped `scope` would grant writes.
    expect(res).toMatchObject({ status: "refused", error: "invalid_token" });
  });

  test("refuses a token minted for another deployment", async () => {
    const keys = makeKeys();
    const jwks = serveJwks([keys.publicJwk]);
    const token = signToken(keys, {
      scope: "val:read",
      aud: "https://other.example.com/api/mcp",
    });

    const res = await verifyValAccessToken(
      request(token),
      oauth(jwks.fetchImpl),
    );

    // Audience binding: without it, one Val site's token works against every
    // other site its owner can reach.
    expect(res).toMatchObject({ status: "refused", error: "invalid_token" });
    if (res.status === "refused") {
      expect(res.description).toContain("aud");
    }
  });

  test("refuses a token approved for another project at this address", async () => {
    const keys = makeKeys();
    const jwks = serveJwks([keys.publicJwk]);
    // Everything an audience check looks at is correct: this is the address the
    // token was minted for, signed by a key the issuer publishes, unexpired.
    const token = signToken(keys, {
      scope: "val:read",
      val_project: "someone-else/site",
    });

    const res = await verifyValAccessToken(
      request(token),
      oauthForProject(jwks.fetchImpl),
    );

    /**
     * The case `aud` cannot catch, because the address *is* the audience.
     *
     * The address is bound to a project by a registration at the authorization
     * server, which this server cannot see. If that binding is ever wrong, a
     * member of another organization approving a token for this address would
     * produce exactly the token above — and without this check it would be
     * honoured, under this app's own API key, against this project's content.
     */
    expect(res).toMatchObject({ status: "refused", error: "invalid_token" });
    if (res.status === "refused") {
      expect(res.description).toContain("val_project");
    }
  });

  test("refuses a token that does not say which project it is for", async () => {
    const keys = makeKeys();
    const jwks = serveJwks([keys.publicJwk]);
    const token = signToken(keys, { scope: "val:read" });

    const res = await verifyValAccessToken(
      request(token),
      oauthForProject(jwks.fetchImpl),
    );

    // Refused rather than accepted for compatibility: "accept it if absent" is
    // a downgrade, and anything that could strip the claim would turn the check
    // off.
    expect(res).toMatchObject({ status: "refused", error: "invalid_token" });
  });

  test("accepts a token approved for the project this server serves", async () => {
    const keys = makeKeys();
    const jwks = serveJwks([keys.publicJwk]);
    const token = signToken(keys, {
      scope: "val:read",
      val_project: PROJECT,
    });

    const res = await verifyValAccessToken(
      request(token),
      oauthForProject(jwks.fetchImpl),
    );

    expect(res).toMatchObject({ status: "ok" });
  });

  test("skips the project check where there is no project to check against", async () => {
    const keys = makeKeys();
    const jwks = serveJwks([keys.publicJwk]);
    const token = signToken(keys, {
      scope: "val:read",
      val_project: "someone-else/site",
    });

    // Local filesystem mode, where `project` is optional: there is no backend
    // and no other tenant, so there is nothing for the claim to protect and
    // nothing to compare it against.
    const res = await verifyValAccessToken(
      request(token),
      oauth(jwks.fetchImpl),
    );

    expect(res).toMatchObject({ status: "ok" });
  });

  test("accepts an audience array that includes this resource", async () => {
    const keys = makeKeys();
    const jwks = serveJwks([keys.publicJwk]);
    const token = signToken(keys, {
      scope: "val:read",
      aud: ["https://other.example.com/api/mcp", RESOURCE],
    });

    const res = await verifyValAccessToken(
      request(token),
      oauth(jwks.fetchImpl),
    );

    // RFC 7519 allows an array, and a token may legitimately be addressed to
    // more than one resource.
    expect(res.status).toBe("ok");
  });

  test("refuses a token from another issuer", async () => {
    const keys = makeKeys();
    const jwks = serveJwks([keys.publicJwk]);
    const token = signToken(keys, {
      scope: "val:read",
      iss: "https://evil.example.com",
    });

    const res = await verifyValAccessToken(
      request(token),
      oauth(jwks.fetchImpl),
    );

    expect(res).toMatchObject({ status: "refused", error: "invalid_token" });
  });

  test("refuses an expired token, and says it can be refreshed", async () => {
    const keys = makeKeys();
    const jwks = serveJwks([keys.publicJwk]);
    // Well beyond the default 60s tolerance, so this tests expiry and not skew.
    const token = signToken(keys, {
      scope: "val:read",
      exp: Math.floor(Date.now() / 1000) - 300,
    });

    const res = await verifyValAccessToken(
      request(token),
      oauth(jwks.fetchImpl),
    );

    expect(res).toMatchObject({ status: "refused", error: "invalid_token" });
    if (res.status === "refused") {
      // The client's move is to refresh, so the message must distinguish this
      // from a token that will never work.
      expect(res.description).toMatch(/expired/i);
    }
  });

  test("refuses a token with no expiry at all", async () => {
    const keys = makeKeys();
    const jwks = serveJwks([keys.publicJwk]);
    const token = signToken(keys, { scope: "val:read", exp: undefined });

    const res = await verifyValAccessToken(
      request(token),
      oauth(jwks.fetchImpl),
    );

    // A bearer token with no expiry is a permanent grant. This is the exact
    // defect `decodeJwt` shipped with, so it gets its own test.
    expect(res).toMatchObject({ status: "refused", error: "invalid_token" });
  });

  test("tolerates small clock skew rather than failing a fresh token", async () => {
    const keys = makeKeys();
    const jwks = serveJwks([keys.publicJwk]);
    const token = signToken(keys, {
      scope: "val:read",
      exp: Math.floor(Date.now() / 1000) - 10,
    });

    const res = await verifyValAccessToken(
      request(token),
      oauth(jwks.fetchImpl),
    );

    // Ten seconds past expiry is inside the default tolerance. Nobody can tell
    // "your clock is off by a second" from "login is broken".
    expect(res.status).toBe("ok");
  });

  test("refuses a token that nominated its own algorithm", async () => {
    const keys = makeKeys();
    const jwks = serveJwks([keys.publicJwk]);
    // `alg: none` with an empty signature is the textbook forgery, and the one
    // a verifier that trusts the header accepts.
    const nowSeconds = Math.floor(Date.now() / 1000);
    const unsigned = `${base64url(
      JSON.stringify({ alg: "none", typ: "JWT" }),
    )}.${base64url(
      JSON.stringify({
        iss: ISSUER,
        aud: RESOURCE,
        sub: "profile-123",
        exp: nowSeconds + 600,
        scope: "val:read val:write",
      }),
    )}.`;

    const res = await verifyValAccessToken(
      request(unsigned),
      oauth(jwks.fetchImpl),
    );

    expect(res).toMatchObject({ status: "refused", error: "invalid_token" });
    if (res.status === "refused") {
      expect(res.description).toMatch(/ES256/);
    }
  });

  test("refuses an HS256 token signed with the published public key", async () => {
    const keys = makeKeys();
    const jwks = serveJwks([keys.publicJwk]);
    // Algorithm confusion, concretely: the attacker knows the public key
    // because it is published, and asks the server to treat it as an HMAC
    // secret. Pinning `alg` is what refuses this before any key is looked at.
    const nowSeconds = Math.floor(Date.now() / 1000);
    const signingInput = `${base64url(
      JSON.stringify({ alg: "HS256", typ: "JWT", kid: "test-key" }),
    )}.${base64url(
      JSON.stringify({
        iss: ISSUER,
        aud: RESOURCE,
        sub: "attacker",
        exp: nowSeconds + 600,
        scope: "val:read val:write",
      }),
    )}`;
    const { createHmac } = await import("node:crypto");
    const forged = `${signingInput}.${createHmac(
      "sha256",
      JSON.stringify(keys.publicJwk),
    )
      .update(signingInput)
      .digest("base64url")}`;

    const res = await verifyValAccessToken(
      request(forged),
      oauth(jwks.fetchImpl),
    );

    expect(res).toMatchObject({ status: "refused", error: "invalid_token" });
  });

  test("refuses a token with no val:read scope", async () => {
    const keys = makeKeys();
    const jwks = serveJwks([keys.publicJwk]);
    const token = signToken(keys, { scope: "val:write" });

    const res = await verifyValAccessToken(
      request(token),
      oauth(jwks.fetchImpl),
    );

    // `insufficient_scope` is a 403 rather than an invitation to authorize
    // again, so the distinction from `invalid_token` is load bearing.
    expect(res).toMatchObject({
      status: "refused",
      error: "insufficient_scope",
    });
  });

  test("treats a missing or wrongly-shaped scope claim as no scopes", async () => {
    const keys = makeKeys();
    const jwks = serveJwks([keys.publicJwk]);

    for (const scope of [undefined, ["val:read"], 42, null]) {
      const res = await verifyValAccessToken(
        request(signToken(keys, { scope })),
        oauth(jwks.fetchImpl),
      );
      // Read generously and an array someone sent would authorize a write.
      expect(res).toMatchObject({
        status: "refused",
        error: "insufficient_scope",
      });
      clearValAccessTokenCache();
    }
  });

  test("refuses when the key set cannot be fetched, and says it may be temporary", async () => {
    const keys = makeKeys();
    const failing: typeof fetch = async () =>
      new Response("boom", { status: 500 });
    const token = signToken(keys, { scope: "val:read" });

    const res = await verifyValAccessToken(request(token), oauth(failing));

    expect(res).toMatchObject({ status: "refused", error: "invalid_token" });
    if (res.status === "refused") {
      // Retrying is the right client behaviour here; re-authorizing is not.
      expect(res.description).toMatch(/temporary/i);
    }
  });

  test("verifies against a rotated key set holding both keys", async () => {
    const oldKeys = makeKeys("old-key");
    const newKeys = makeKeys("test-key");
    // Mid-rotation: the issuer publishes both, and tokens signed with either
    // must keep working or every editor is logged out at the moment of a
    // rotation.
    const jwks = serveJwks([oldKeys.publicJwk, newKeys.publicJwk]);

    const res = await verifyValAccessToken(
      request(signToken(newKeys, { scope: "val:read" })),
      oauth(jwks.fetchImpl),
    );

    expect(res.status).toBe("ok");
  });

  test("fetches the key set once across many calls", async () => {
    const keys = makeKeys();
    const jwks = serveJwks([keys.publicJwk]);
    const token = signToken(keys, { scope: "val:read" });
    const config = oauth(jwks.fetchImpl);

    await verifyValAccessToken(request(token), config);
    await verifyValAccessToken(request(token), config);
    await verifyValAccessToken(request(token), config);

    // The cache has to outlive the request or it is not a cache: three calls
    // that each fetched the issuer's keys would put a round trip on every tool
    // call.
    expect(jwks.calls()).toBe(1);
  });

  test("coalesces concurrent misses into one fetch", async () => {
    const keys = makeKeys();
    const jwks = serveJwks([keys.publicJwk]);
    const token = signToken(keys, { scope: "val:read" });
    const config = oauth(jwks.fetchImpl);

    const results = await Promise.all([
      verifyValAccessToken(request(token), config),
      verifyValAccessToken(request(token), config),
      verifyValAccessToken(request(token), config),
    ]);

    expect(results.every((res) => res.status === "ok")).toBe(true);
    // A cold start serving a burst should not fetch the key set once per
    // request in flight.
    expect(jwks.calls()).toBe(1);
  });

  test("refetches once for a kid the cached key set does not hold, then verifies", async () => {
    const oldKeys = makeKeys("old-key");
    const newKeys = makeKeys("new-key");
    const jwks = serveJwks([oldKeys.publicJwk]);
    const config = oauth(jwks.fetchImpl);

    // Warm the cache on the pre-rotation key set.
    await verifyValAccessToken(
      request(signToken(oldKeys, { scope: "val:read" }, { kid: "old-key" })),
      config,
    );
    expect(jwks.calls()).toBe(1);

    // The issuer rotates. Without a refetch this token is refused for the rest
    // of the five-minute TTL, on every warm instance at once, which is a
    // rotation turning into an outage.
    jwks.publish([oldKeys.publicJwk, newKeys.publicJwk]);
    const res = await verifyValAccessToken(
      request(signToken(newKeys, { scope: "val:read" }, { kid: "new-key" })),
      config,
    );

    expect(res.status).toBe("ok");
    expect(jwks.calls()).toBe(2);

    // And the refetch replaced the cache rather than being a one-off: the next
    // token with the same `kid` costs nothing.
    const again = await verifyValAccessToken(
      request(signToken(newKeys, { scope: "val:read" }, { kid: "new-key" })),
      config,
    );
    expect(again.status).toBe("ok");
    expect(jwks.calls()).toBe(2);
  });

  test("does not refetch again for further unknown kids inside the window", async () => {
    const keys = makeKeys("published-key");
    const jwks = serveJwks([keys.publicJwk]);
    const config = oauth(jwks.fetchImpl);

    await verifyValAccessToken(
      request(signToken(keys, { scope: "val:read" }, { kid: "published-key" })),
      config,
    );
    expect(jwks.calls()).toBe(1);

    // The `kid` is attacker-controlled, so an unknown one must not be a lever
    // for making this server call its own issuer once per request. The first
    // spends the window; the rest are refused out of the cache.
    const attempts = ["ghost-1", "ghost-2", "ghost-3", "ghost-4"];
    for (const kid of attempts) {
      const res = await verifyValAccessToken(
        request(signToken(keys, { scope: "val:read" }, { kid })),
        config,
      );
      expect(res).toMatchObject({ status: "refused", error: "invalid_token" });
    }

    expect(jwks.calls()).toBe(2);
  });

  test("a burst arriving during a rotation all joins the one refetch", async () => {
    const oldKeys = makeKeys("old-key");
    const newKeys = makeKeys("new-key");
    const jwks = serveJwks([oldKeys.publicJwk]);
    const config = oauth(jwks.fetchImpl);

    await verifyValAccessToken(
      request(signToken(oldKeys, { scope: "val:read" }, { kid: "old-key" })),
      config,
    );
    expect(jwks.calls()).toBe(1);

    jwks.publish([oldKeys.publicJwk, newKeys.publicJwk]);
    const release = jwks.hold();

    // The shape of a real rotation: not one request meeting the new key, but
    // every in-flight request meeting it at once. The rate limit is on starting
    // a fetch — a request that arrives while one is already running has to join
    // it, or all but the first are refused and the rotation is still an outage.
    const pending = Promise.all([
      verifyValAccessToken(
        request(signToken(newKeys, { scope: "val:read" }, { kid: "new-key" })),
        config,
      ),
      verifyValAccessToken(
        request(signToken(newKeys, { scope: "val:read" }, { kid: "new-key" })),
        config,
      ),
      verifyValAccessToken(
        request(signToken(newKeys, { scope: "val:read" }, { kid: "new-key" })),
        config,
      ),
    ]);
    // A macrotask boundary, so every one of the three has reached the fetch
    // before it is allowed to resolve. Awaiting microtasks would not prove it.
    await new Promise((resolve) => setTimeout(resolve, 0));
    release();

    const results = await pending;
    expect(results.map((res) => res.status)).toEqual(["ok", "ok", "ok"]);
    // Joined, not repeated: the issuer saw one more request, not three.
    expect(jwks.calls()).toBe(2);
  });

  test("a failed unknown-kid refetch leaves the cached key set alone", async () => {
    const keys = makeKeys("published-key");
    const jwks = serveJwks([keys.publicJwk]);
    const config = oauth(jwks.fetchImpl);
    const good = signToken(
      keys,
      { scope: "val:read" },
      { kid: "published-key" },
    );

    expect((await verifyValAccessToken(request(good), config)).status).toBe(
      "ok",
    );
    expect(jwks.calls()).toBe(1);

    // One token naming a key that does not exist, arriving while the issuer is
    // briefly down. Nothing about it should be able to reach the keys we
    // already hold — but the forced refetch writes the cache, so before the
    // fix a single such token replaced a live key set with an error entry and
    // took every other token down with it for the error TTL.
    jwks.breakIssuer();
    const refused = await verifyValAccessToken(
      request(signToken(keys, { scope: "val:read" }, { kid: "ghost" })),
      config,
    );
    expect(refused).toMatchObject({
      status: "refused",
      error: "invalid_token",
    });
    expect(jwks.calls()).toBe(2);

    // The load-bearing assertion: a token signed by a key we had cached all
    // along still verifies, and costs no further fetch.
    expect((await verifyValAccessToken(request(good), config)).status).toBe(
      "ok",
    );
    expect(jwks.calls()).toBe(2);
  });

  test("says the keys could not be fetched when the refetch itself failed", async () => {
    const keys = makeKeys("published-key");
    const jwks = serveJwks([keys.publicJwk]);
    const config = oauth(jwks.fetchImpl);

    await verifyValAccessToken(
      request(signToken(keys, { scope: "val:read" }, { kid: "published-key" })),
      config,
    );
    jwks.breakIssuer();

    const res = await verifyValAccessToken(
      request(signToken(keys, { scope: "val:read" }, { kid: "ghost" })),
      config,
    );

    expect(res).toMatchObject({ status: "refused", error: "invalid_token" });
    if (res.status === "refused") {
      // "The issuer does not publish that key" is not something we learned —
      // the request that would have told us never arrived. Saying it anyway
      // sends the client off to re-authorize when it should retry.
      expect(res.description).toMatch(/temporary/i);
      expect(res.description).not.toMatch(/does not publish/i);
    }
  });

  test("does not refetch on an unknown kid when the cached key set is an error", async () => {
    const keys = makeKeys();
    let calls = 0;
    const failing: typeof fetch = async () => {
      calls++;
      return new Response("boom", { status: 500 });
    };
    const config = oauth(failing);
    const token = signToken(keys, { scope: "val:read" });

    const first = await verifyValAccessToken(request(token), config);
    expect(first).toMatchObject({ status: "refused", error: "invalid_token" });
    expect(calls).toBe(1);

    // An unreachable issuer already has its own, shorter recovery TTL. Letting
    // an unknown `kid` shortcut it would hand a struggling issuer a retry storm
    // from every resource server at once — the failure mode the error cache
    // exists to prevent.
    const second = await verifyValAccessToken(request(token), config);
    expect(second).toMatchObject({ status: "refused", error: "invalid_token" });
    expect(calls).toBe(1);
  });
});
