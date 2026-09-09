import { createPublicKey, verify as cryptoVerify } from "node:crypto";
import {
  VAL_SCOPE_READ,
  authorIdFromVerifiedSubject,
  type ValToolAuth,
} from "./tools";

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
 *   The key set is cached, but a token naming a `kid` the cache does not hold
 *   provokes one rate-limited refetch rather than a refusal — see
 *   {@link UNKNOWN_KID_REFETCH_INTERVAL_MS}. Without that, this server's own
 *   cache turns any key rotation into an outage lasting the rest of the TTL.
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
/**
 * The floor between two refetches provoked by an unknown `kid`.
 *
 * A token naming a key this process has not seen is the one case where the TTL
 * is the wrong answer: the issuer may have just rotated, and refusing for the
 * rest of the five minutes turns a rotation into an outage. So an unknown `kid`
 * bypasses the TTL — but only this often, because the `kid` comes from the
 * token and the token comes from whoever is calling. Without a floor, a stream
 * of random `kid`s would be a way to make this server hammer its own issuer.
 *
 * Note what the floor costs when it bites: a refusal, for a token that would
 * have verified, for at most this long. That is the same failure the TTL used
 * to guarantee for five minutes, so the trade only ever improves.
 */
const UNKNOWN_KID_REFETCH_INTERVAL_MS = 30 * 1000;

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
/**
 * When an unknown `kid` last made us go back to the issuer, per issuer.
 *
 * Separate from the cache because it is a rate limit rather than a cache: it
 * records an *attempt*, so a refetch that found nothing new still spends the
 * window. Keyed by issuer, not by `kid`, or an attacker would simply use a new
 * one each time.
 */
const unknownKidRefetchAtMs = new Map<string, number>();

/** Test seam: a fresh process would have an empty cache anyway. */
export function clearValAccessTokenCache(): void {
  jwksCache.clear();
  inFlight.clear();
  unknownKidRefetchAtMs.clear();
}

function jwksUrl(issuer: string): string {
  // Not discovered from the issuer's metadata document, deliberately:
  // discovery would mean one more request on the hot path and one more thing
  // that can be pointed elsewhere. The location is fixed by convention and by
  // Val's own authorization server.
  return new URL("/.well-known/jwks.json", issuer).toString();
}

type JwksLoad = {
  entry: JwksCacheEntry;
  /**
   * Whether this came from the cache rather than the network.
   *
   * Only the unknown-`kid` path cares: going straight back to the issuer for a
   * key set that was fetched a millisecond ago cannot find anything the first
   * fetch missed.
   */
  fromCache: boolean;
};

async function loadJwks(
  config: ValOAuthConfig,
  nowMs: number,
): Promise<JwksLoad> {
  const url = jwksUrl(config.issuer);
  const cached = jwksCache.get(url);
  if (cached) {
    const age =
      cached.status === "keys"
        ? nowMs - cached.fetchedAtMs
        : nowMs - cached.failedAtMs;
    const ttl = cached.status === "keys" ? JWKS_TTL_MS : JWKS_ERROR_TTL_MS;
    if (age < ttl) {
      return { entry: cached, fromCache: true };
    }
  }
  return { entry: await fetchJwks(config, nowMs), fromCache: false };
}

/**
 * Go back to the issuer because the token named a key we do not have.
 *
 * Rate-limited, and the limit is the whole reason this is not just a call to
 * {@link fetchJwks}: the `kid` that triggers it is attacker-controlled. Returns
 * `null` when the window has not elapsed, which the caller reads as "nothing
 * new to try" rather than as a failure.
 *
 * The limit is on *starting* a fetch, not on benefiting from one. A fetch
 * already in flight is joined whatever the window says, because joining it
 * costs the issuer nothing — and the case that matters is precisely a burst:
 * at a rotation, many requests arrive at once carrying the same new `kid`, and
 * refusing all but the first would be the outage this whole path exists to
 * prevent, merely shortened from five minutes to thirty seconds.
 *
 * Only ever called with a successfully-fetched key set in hand. An error entry
 * has its own, shorter TTL and its own recovery, and letting an unknown `kid`
 * shortcut it would hand an unreachable issuer a retry storm.
 */
async function refetchForUnknownKid(
  config: ValOAuthConfig,
  nowMs: number,
): Promise<JwksCacheEntry | null> {
  const url = jwksUrl(config.issuer);
  const existing = inFlight.get(url);
  if (existing) {
    // Somebody is already asking. Waiting for their answer adds no request to
    // the issuer, so the rate limit has nothing to protect against here.
    return existing;
  }
  const lastAttemptMs = unknownKidRefetchAtMs.get(url);
  if (
    lastAttemptMs !== undefined &&
    nowMs - lastAttemptMs < UNKNOWN_KID_REFETCH_INTERVAL_MS
  ) {
    return null;
  }
  // Recorded before the await, so that once this fetch has finished the window
  // is already closed against the next unknown `kid`.
  unknownKidRefetchAtMs.set(url, nowMs);
  return fetchJwks(config, nowMs, { keepCacheOnError: true });
}

/**
 * Fetch the key set, ignoring whatever is cached, and cache the result.
 *
 * Shares {@link inFlight} with every other caller, so a forced refetch that
 * lands during an ordinary miss joins it rather than opening a second request.
 * Only the caller that *starts* a fetch writes the cache — a joiner returns the
 * shared promise above — so `keepCacheOnError` is a property of the fetch, not a
 * race between callers.
 */
async function fetchJwks(
  config: ValOAuthConfig,
  nowMs: number,
  {
    /**
     * Leave a good cached key set alone if this fetch fails.
     *
     * For the unknown-`kid` path, where the cache being replaced is *live* —
     * fetched inside its TTL and able to verify every token signed by a key it
     * already holds. Overwriting that with an error entry on a transient 500
     * would refuse those tokens too, for the length of the error TTL, and the
     * `kid` that triggered the fetch comes from whoever is calling: one token
     * naming a key that does not exist would be enough to do it.
     *
     * Deliberately off for the ordinary TTL-expiry fetch. There the cached set
     * is stale by policy, and "we could not reach the issuer" is the honest
     * answer rather than a set we have decided to stop trusting.
     */
    keepCacheOnError = false,
  }: { keepCacheOnError?: boolean } = {},
): Promise<JwksCacheEntry> {
  const url = jwksUrl(config.issuer);
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
    const cached = jwksCache.get(url);
    if (
      entry.status === "error" &&
      keepCacheOnError &&
      cached?.status === "keys"
    ) {
      // Keep the good set, and keep its original `fetchedAtMs` so it still
      // expires on schedule: this preserves a cache, it does not extend one.
      // The failure is still reported to the caller, which is what lets the
      // refusal say "could not be fetched" rather than "not published".
      return entry;
    }
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
  // `in` narrows the property into the type, so no assertion is needed to read
  // it — and the `Array.isArray` below is what actually establishes the shape.
  const keys: unknown = body.keys;
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
  const loaded = await loadJwks(config, nowMs);
  if (loaded.entry.status === "error") {
    // Refusing is right — an unverifiable token is not a valid one — but the
    // message says it may pass, because retrying is the correct client
    // behaviour here and re-authorizing is not.
    return invalidToken(
      "The access token could not be verified because the Val authorization server's keys could not be fetched. This may be temporary.",
    );
  }

  let candidates = loaded.entry.keys.filter((key) =>
    isVerifyingP256Key(key, kid),
  );
  if (candidates.length === 0 && kid !== null && loaded.fromCache) {
    /**
     * A named key we have never seen, out of a key set we did not just fetch.
     *
     * The likeliest cause is a rotation the issuer has already published and
     * this process has not looked at yet, and refusing until the TTL elapses
     * would make every warm instance reject valid tokens for up to five
     * minutes — an outage produced entirely by our own caching.
     *
     * So: go and look, once per issuer per window. If the key set has genuinely
     * not changed, the refusal below is the same refusal as before, only later.
     */
    const refetched = await refetchForUnknownKid(config, nowMs);
    if (refetched !== null) {
      if (refetched.status === "error") {
        // The one request that could have told us about this key did not
        // arrive, so "the issuer does not publish that key" is not something
        // we know — it is a guess, and the wrong one sends the client off to
        // re-authorize when it should simply retry. The cache still holds the
        // keys it had, so this refusal is confined to tokens naming a `kid` we
        // have not seen.
        return invalidToken(
          "The access token could not be verified because the Val authorization server's keys could not be fetched. This may be temporary.",
        );
      }
      candidates = refetched.keys.filter((key) => isVerifyingP256Key(key, kid));
    }
  }
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
  // filter above leaves one — or, if this process had not yet seen that key,
  // the one the refetch just found.
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
