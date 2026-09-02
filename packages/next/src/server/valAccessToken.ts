import { createPublicKey, verify as cryptoVerify } from "node:crypto";
import {
  VAL_SCOPE_READ,
  authorIdFromVerifiedSubject,
  type ValToolAuth,
} from "@valbuild/server";

/**
 * Verifying an OAuth access token, which is the whole of what makes this app a
 * resource server rather than a relay.
 *
 * The token is issued by Val's authorization server and presented by an MCP
 * client. This app holds no signing key for it and cannot mint one — it fetches
 * the issuer's *public* keys and checks a signature. That asymmetry is the
 * point: a verified `sub` is a fact about the token rather than a claim by
 * whoever sent it, which is what lets the tools attribute a patch to that
 * profile at all.
 *
 * ## Why this is not `jose`
 *
 * `jose` was the first choice and was rejected on a fact rather than a
 * preference: version 6 is ESM-only (`"type": "module"`, no CJS export). This
 * package is built by preconstruct and `require`d by Next.js server code, so an
 * ESM-only dependency here is a runtime failure in consumers' apps, not a build
 * inconvenience. Adding it would also put a dependency in every install of
 * `@valbuild/next` for one function.
 *
 * The actual cryptography is still not hand-rolled — `node:crypto` does the
 * ECDSA and the JWK import. What is written here is the JWS envelope and the
 * claim checks, and the rules that keep that safe are worth stating because
 * this repository has already shipped the counterexample (`decodeJwt`: `exp`
 * never checked, a non-constant-time compare, verification skippable):
 *
 * - **`alg` is pinned**, not read from the token. The header is only consulted
 *   for `kid`. A verifier that honours the token's own `alg` can be handed
 *   `HS256` and will treat the *published* public key as a shared secret.
 * - **Nothing is read from the payload before the signature verifies.** Claims
 *   from an unverified token are attacker input.
 * - **Keys come only from the configured issuer's JWKS**, never from the token.
 * - **ECDSA JWS signatures are raw `r||s`** (RFC 7518), not DER, which is what
 *   `dsaEncoding: "ieee-p1363"` below is for. Omit it and every valid signature
 *   is rejected — or worse, a future change makes it accept the wrong thing.
 */

export type ValOAuthConfig = {
  /**
   * The authorization server, and therefore the expected `iss`.
   *
   * Also where the JWKS is fetched from, so it is the one value that decides
   * which keys can produce a token this app accepts. Configuration, never
   * request input — a request that could name its own issuer could name its own
   * key.
   */
  issuer: string;
  /**
   * This endpoint's absolute URL, and therefore the expected `aud` (RFC 8707).
   *
   * Audience binding is what stops a token minted for one Val site being
   * replayed against another: without it, any deployment the user has access to
   * would accept a token issued for any other.
   */
  resource: string;
  /**
   * Clock skew allowance, in seconds.
   *
   * Servers disagree about the time by more than you would like, and a token
   * refused for being a second early is indistinguishable, to the person using
   * it, from a broken login.
   */
  clockToleranceSeconds?: number;
  /** Test seam. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
};

export type ValAccessTokenResult =
  | { status: "ok"; auth: Extract<ValToolAuth, { type: "verified-profile" }> }
  | {
      status: "refused";
      /** For the `WWW-Authenticate` challenge: RFC 6750 section 3.1. */
      error: "invalid_request" | "invalid_token" | "insufficient_scope";
      description: string;
    };

const DEFAULT_CLOCK_TOLERANCE_SECONDS = 60;
/** How long a fetched key set is reused before it is fetched again. */
const JWKS_TTL_MS = 5 * 60 * 1000;
/**
 * How long to wait before re-fetching after a failure.
 *
 * Shorter than the success TTL so a key rotation recovers quickly, but not zero:
 * an unreachable issuer must not turn every tool call into another request to
 * it.
 */
const JWKS_ERROR_TTL_MS = 30 * 1000;

type Jwk = {
  kty?: unknown;
  crv?: unknown;
  kid?: unknown;
  alg?: unknown;
  use?: unknown;
  x?: unknown;
  y?: unknown;
};

type JwksCacheEntry =
  | { status: "keys"; keys: Jwk[]; fetchedAtMs: number }
  | { status: "error"; failedAtMs: number };

/**
 * One cache per issuer, and it has to outlive the request or it is not a cache:
 * a fetch per tool call would put a network round trip in front of every read.
 */
const jwksCache = new Map<string, JwksCacheEntry>();
/** Concurrent misses share one fetch rather than starting several. */
const inFlight = new Map<string, Promise<JwksCacheEntry>>();

/** Test seam: a fresh process would have an empty cache anyway. */
export function clearValAccessTokenCache(): void {
  jwksCache.clear();
  inFlight.clear();
}

function jwksUrl(issuer: string): string {
  // Not discovered from the issuer's metadata document, deliberately:
  // discovery would mean one more request on the hot path and one more thing
  // that can be pointed elsewhere. The location is fixed by convention and by
  // Val's own authorization server.
  return new URL("/.well-known/jwks.json", issuer).toString();
}

async function loadJwks(
  config: ValOAuthConfig,
  nowMs: number,
): Promise<JwksCacheEntry> {
  const url = jwksUrl(config.issuer);
  const cached = jwksCache.get(url);
  if (cached) {
    const age =
      cached.status === "keys"
        ? nowMs - cached.fetchedAtMs
        : nowMs - cached.failedAtMs;
    const ttl = cached.status === "keys" ? JWKS_TTL_MS : JWKS_ERROR_TTL_MS;
    if (age < ttl) {
      return cached;
    }
  }
  const existing = inFlight.get(url);
  if (existing) {
    return existing;
  }
  const fetchImpl = config.fetchImpl ?? fetch;
  const pending = (async (): Promise<JwksCacheEntry> => {
    try {
      const res = await fetchImpl(url, {
        headers: { accept: "application/json" },
      });
      if (!res.ok) {
        return { status: "error", failedAtMs: nowMs };
      }
      const body: unknown = await res.json();
      const keys = readKeys(body);
      if (keys === null) {
        return { status: "error", failedAtMs: nowMs };
      }
      return { status: "keys", keys, fetchedAtMs: nowMs };
    } catch {
      return { status: "error", failedAtMs: nowMs };
    }
  })();
  inFlight.set(url, pending);
  try {
    const entry = await pending;
    jwksCache.set(url, entry);
    return entry;
  } finally {
    inFlight.delete(url);
  }
}

function readKeys(body: unknown): Jwk[] | null {
  if (typeof body !== "object" || body === null || !("keys" in body)) {
    return null;
  }
  const keys = (body as { keys: unknown }).keys;
  if (!Array.isArray(keys)) {
    return null;
  }
  return keys.filter(
    (key): key is Jwk => typeof key === "object" && key !== null,
  );
}

/**
 * Read `Authorization: Bearer …`.
 *
 * Exported because the refusal needs to know whether a token was presented at
 * all: RFC 6750 distinguishes "no credential" — a bare `401`, which is an
 * invitation to authenticate — from "a bad credential", and a client that gets
 * the second when it deserved the first will not start the authorization flow.
 */
export function readBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) {
    return null;
  }
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  return token ? token : null;
}

export async function verifyValAccessToken(
  request: Request,
  config: ValOAuthConfig,
): Promise<ValAccessTokenResult> {
  const token = readBearerToken(request);
  if (token === null) {
    return {
      status: "refused",
      error: "invalid_request",
      description:
        "This Val MCP endpoint needs an access token. Authorize with the Val authorization server and present it as `Authorization: Bearer`.",
    };
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    return invalidToken("The access token is not a JWS.");
  }
  const [encodedHeader, encodedPayload, encodedSignature] = parts;

  const header = decodeJsonSegment(encodedHeader);
  if (header === null) {
    return invalidToken("The access token's header could not be read.");
  }
  // Pinned. See the note at the top of this file: honouring the token's own
  // `alg` is the algorithm-confusion bug, and `ES256` is what Val's
  // authorization server signs with.
  if (header.alg !== "ES256") {
    return invalidToken(
      "The access token is not signed with ES256, which is the only algorithm this server accepts.",
    );
  }
  const kid = typeof header.kid === "string" ? header.kid : null;

  const nowMs = Date.now();
  const jwks = await loadJwks(config, nowMs);
  if (jwks.status === "error") {
    // Refusing is right — an unverifiable token is not a valid one — but the
    // message says it may pass, because retrying is the correct client
    // behaviour here and re-authorizing is not.
    return invalidToken(
      "The access token could not be verified because the Val authorization server's keys could not be fetched. This may be temporary.",
    );
  }

  const candidates = jwks.keys.filter((key) => isVerifyingP256Key(key, kid));
  if (candidates.length === 0) {
    return invalidToken(
      "The access token was signed with a key the Val authorization server does not publish.",
    );
  }

  const signature = decodeBase64Url(encodedSignature);
  if (signature === null) {
    return invalidToken("The access token's signature could not be read.");
  }
  const signedData = Buffer.from(`${encodedHeader}.${encodedPayload}`, "ascii");
  // Every published key is tried when the token names no `kid`, so a rotation
  // that has not yet propagated to clients still verifies. With a `kid` the
  // filter above leaves one.
  const verified = candidates.some((key) =>
    verifyWithJwk(key, signedData, signature),
  );
  if (!verified) {
    return invalidToken("The access token's signature could not be verified.");
  }

  // Only now: everything below reads the payload, and before this line it was
  // attacker input.
  const payload = decodeJsonSegment(encodedPayload);
  if (payload === null) {
    return invalidToken("The access token's payload could not be read.");
  }

  const tolerance =
    config.clockToleranceSeconds ?? DEFAULT_CLOCK_TOLERANCE_SECONDS;
  const nowSeconds = Math.floor(nowMs / 1000);

  if (typeof payload.exp !== "number") {
    // A token with no expiry is not a token, it is a permanent grant.
    return invalidToken("The access token has no expiry.");
  }
  if (payload.exp + tolerance <= nowSeconds) {
    return invalidToken(
      "The access token has expired. Refresh it and try again.",
    );
  }
  if (typeof payload.nbf === "number" && payload.nbf - tolerance > nowSeconds) {
    return invalidToken("The access token is not valid yet.");
  }
  if (payload.iss !== config.issuer) {
    return invalidToken(
      "The access token was not issued by this server's authorization server (iss claim).",
    );
  }
  if (!audienceMatches(payload.aud, config.resource)) {
    // The common misconfiguration, and the one worth naming precisely: the fix
    // is to point the client at the right deployment.
    return invalidToken(
      "The access token is not valid for this server (aud claim).",
    );
  }
  const subject = payload.sub;
  if (typeof subject !== "string" || subject.length === 0) {
    return invalidToken("The access token has no subject.");
  }

  const scopes = readScopes(payload.scope);
  if (!scopes.includes(VAL_SCOPE_READ)) {
    // Refused here rather than at the first tool: a token with no read scope
    // cannot do anything at all, so treating it as authenticated would only
    // move the failure somewhere less legible.
    return {
      status: "refused",
      error: "insufficient_scope",
      description: `The access token does not have the ${VAL_SCOPE_READ} scope, so it cannot read any content.`,
    };
  }

  return {
    status: "ok",
    auth: {
      type: "verified-profile",
      profileId: authorIdFromVerifiedSubject(subject),
      scopes,
    },
  };
}

function invalidToken(description: string): ValAccessTokenResult {
  // Described by class, never by echoing the token or a raw error: a
  // verification failure message is a place credentials leak into logs.
  return { status: "refused", error: "invalid_token", description };
}

/**
 * `aud` is a string or an array of strings (RFC 7519 section 4.1.3).
 *
 * A match on any member is a match, which is the spec's own rule — a token may
 * legitimately be addressed to several resources.
 */
function audienceMatches(claim: unknown, resource: string): boolean {
  if (typeof claim === "string") {
    return claim === resource;
  }
  if (Array.isArray(claim)) {
    return claim.some((entry) => entry === resource);
  }
  return false;
}

/**
 * `scope` is a space-delimited string (RFC 6749 section 3.3).
 *
 * Anything else is read as no scopes rather than coerced. A token whose scope
 * claim is the wrong shape is a token we do not understand, and understanding
 * it generously is how a write gets authorized by an array someone sent.
 */
function readScopes(claim: unknown): string[] {
  if (typeof claim !== "string") {
    return [];
  }
  return claim.split(" ").filter((scope) => scope.length > 0);
}

function isVerifyingP256Key(key: Jwk, kid: string | null): boolean {
  if (key.kty !== "EC" || key.crv !== "P-256") {
    return false;
  }
  if (typeof key.x !== "string" || typeof key.y !== "string") {
    return false;
  }
  // A key published for encryption is not a key to verify signatures with, and
  // an `alg` that disagrees with what we verify is a key meant for something
  // else.
  if (key.use !== undefined && key.use !== "sig") {
    return false;
  }
  if (key.alg !== undefined && key.alg !== "ES256") {
    return false;
  }
  if (kid !== null && typeof key.kid === "string" && key.kid !== kid) {
    return false;
  }
  return true;
}

function verifyWithJwk(
  key: Jwk,
  signedData: Buffer,
  signature: Buffer,
): boolean {
  try {
    const publicKey = createPublicKey({
      key: { kty: "EC", crv: "P-256", x: String(key.x), y: String(key.y) },
      format: "jwk",
    });
    return cryptoVerify(
      "sha256",
      signedData,
      // `ieee-p1363` because a JWS ECDSA signature is the raw `r||s` pair, while
      // node defaults to DER for EC keys. Getting this wrong rejects every
      // valid signature.
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      signature,
    );
  } catch {
    // A malformed key in an otherwise good key set should not take down
    // verification against the other keys.
    return false;
  }
}

function decodeBase64Url(segment: string | undefined): Buffer | null {
  if (segment === undefined || !/^[A-Za-z0-9_-]*$/.test(segment)) {
    return null;
  }
  try {
    return Buffer.from(segment, "base64url");
  } catch {
    return null;
  }
}

function decodeJsonSegment(
  segment: string | undefined,
): Record<string, unknown> | null {
  const decoded = decodeBase64Url(segment);
  if (decoded === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(decoded.toString("utf8"));
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return null;
    }
    return { ...parsed };
  } catch {
    return null;
  }
}
