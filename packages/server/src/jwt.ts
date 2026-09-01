import crypto from "crypto";
import { z } from "zod";

const JwtPayloadSchema = z
  .object({
    sub: z.string(),
    exp: z.number(),
    org: z.string(),
    project: z.string(),
  })
  // NOTE: passthrough, because the session cookie payload carries more than
  // this (the val.build token, notably). This is the minimum every Val JWT has.
  .passthrough();

export type JwtPayload = z.infer<typeof JwtPayloadSchema>;

export type JwtFailureReason =
  /** Not a JWT we issued: wrong number of segments, bad header, or a payload that is not a Val payload. */
  | "malformed"
  /** The HMAC did not match: the token was forged or tampered with. */
  | "invalid-signature"
  /** The token parsed and verified, but `exp` is in the past. */
  | "expired"
  /** Programming error: {@link verifyJwt} was called without a secret. */
  | "missing-secret";

export type JwtFailure = {
  success: false;
  reason: JwtFailureReason;
  message: string;
};

export type JwtResult = { success: true; data: JwtPayload } | JwtFailure;

/**
 * `exp` is an absolute Unix timestamp: a token is rejected once that moment has
 * passed, with this much slack to absorb clock drift between whoever signed the
 * token and us.
 */
const CLOCK_SKEW_LEEWAY_SECONDS = 60;

function failure(reason: JwtFailureReason, message: string): JwtFailure {
  // NOTE: deliberately never logs the token itself - it is a credential, and
  // anything we print here ends up in the host's request logs.
  console.debug(`Invalid JWT (${reason}): ${message}`);
  return { success: false, reason, message };
}

type JwtSegments = {
  headerBase64: string;
  payloadBase64: string;
  signatureBase64: string;
};

function splitToken(token: string): JwtSegments | null {
  const [headerBase64, payloadBase64, signatureBase64, ...rest] =
    token.split(".");
  if (!headerBase64 || !payloadBase64 || !signatureBase64 || rest.length > 0) {
    return null;
  }
  return { headerBase64, payloadBase64, signatureBase64 };
}

/** Returns the failure if the header is not one of ours, or null if it is fine. */
function verifyHeader(headerBase64: string): JwtFailure | null {
  let parsedHeader: unknown;
  try {
    parsedHeader = JSON.parse(
      Buffer.from(headerBase64, "base64").toString("utf8"),
    );
  } catch {
    return failure("malformed", "could not parse header");
  }
  const headerVerification = JwtHeaderSchema.safeParse(parsedHeader);
  if (!headerVerification.success) {
    // NOTE: JwtHeaderSchema pins alg to HS256, so `alg: "none"` and every other
    // algorithm-confusion header is rejected here, before we look at the
    // signature at all.
    return failure("malformed", "unsupported header");
  }
  return null;
}

function parsePayload(payloadBase64: string): JwtResult {
  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(
      Buffer.from(payloadBase64, "base64").toString("utf8"),
    );
  } catch {
    return failure("malformed", "could not parse payload");
  }
  const payloadVerification = JwtPayloadSchema.safeParse(parsedPayload);
  if (!payloadVerification.success) {
    return failure("malformed", "payload is not a Val JWT payload");
  }
  const payload = payloadVerification.data;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (payload.exp + CLOCK_SKEW_LEEWAY_SECONDS <= nowSeconds) {
    return failure("expired", "token expired");
  }
  return { success: true, data: payload };
}

/**
 * Verify a JWT that we issued with {@link encodeJwt}, and return its payload.
 *
 * Checks, in order: the segment count, the header (`alg` is pinned to HS256, so
 * algorithm confusion is rejected before the signature is looked at), the HMAC
 * (compared in constant time), the payload shape, and `exp`.
 *
 * There is deliberately no way to make this skip the signature check: the
 * secret is required, and an empty one is a failure rather than a token that
 * validates against `HMAC("")`. Use {@link decodeJwtWithoutVerifying} - and read
 * what it says - when you genuinely do not hold the signing key.
 */
export function verifyJwt(token: string, secretKey: string): JwtResult {
  if (!secretKey) {
    return failure("missing-secret", "no secret key was provided");
  }
  const segments = splitToken(token);
  if (!segments) {
    return failure(
      "malformed",
      "format is not exactly {header}.{payload}.{signature}",
    );
  }
  const { headerBase64, payloadBase64, signatureBase64 } = segments;

  const headerFailure = verifyHeader(headerBase64);
  if (headerFailure) {
    return headerFailure;
  }

  const expectedSignature = crypto
    .createHmac("sha256", secretKey)
    .update(`${headerBase64}.${payloadBase64}`)
    .digest();
  const actualSignature = Buffer.from(signatureBase64, "base64");
  // NOTE: the length check is what makes timingSafeEqual usable at all (it
  // throws on a length mismatch), and the length of an HMAC-SHA256 is public.
  if (
    actualSignature.length !== expectedSignature.length ||
    !crypto.timingSafeEqual(actualSignature, expectedSignature)
  ) {
    return failure("invalid-signature", "signature does not match");
  }

  return parsePayload(payloadBase64);
}

/**
 * Parse a JWT's payload **without checking its signature**.
 *
 * The header, the payload shape and `exp` are still validated, but nothing here
 * establishes that the token was issued by anyone in particular. Only use this
 * for a token whose authenticity is already established by the channel it
 * arrived on - the app token we fetch from val.build over an api-key
 * authenticated HTTPS request is the one such case. Anything that arrives from
 * a browser (a cookie, a header, a query parameter) must go through
 * {@link verifyJwt}.
 */
export function decodeJwtWithoutVerifying(token: string): JwtResult {
  const segments = splitToken(token);
  if (!segments) {
    return failure(
      "malformed",
      "format is not exactly {header}.{payload}.{signature}",
    );
  }
  const headerFailure = verifyHeader(segments.headerBase64);
  if (headerFailure) {
    return headerFailure;
  }
  return parsePayload(segments.payloadBase64);
}

export function getExpire(): number {
  return Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 4; // 4 days
}

const JwtHeaderSchema = z.object({
  alg: z.literal("HS256"),
  typ: z.literal("JWT"),
});
type JwtHeader = z.infer<typeof JwtHeaderSchema>;
const jwtHeader: JwtHeader = {
  alg: "HS256",
  typ: "JWT",
};

const jwtHeaderBase64 = Buffer.from(JSON.stringify(jwtHeader)).toString(
  "base64",
);

export function encodeJwt(payload: object, sessionKey: string): string {
  // NOTE: this is only used for authentication, not for authorization (i.e. what a user can do) - this is handled when actually doing operations
  const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString("base64");
  return `${jwtHeaderBase64}.${payloadBase64}.${crypto
    .createHmac("sha256", sessionKey)
    .update(`${jwtHeaderBase64}.${payloadBase64}`)
    .digest("base64")}`;
}
