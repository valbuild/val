import crypto from "crypto";

export function decodeJwt(token: string, secretKey?: string): unknown | null {
  const [headerBase64, payloadBase64, signatureBase64, ...rest] =
    token.split(".");
  if (!headerBase64 || !payloadBase64 || !signatureBase64 || rest.length > 0) {
    console.debug(
      "Invalid JWT: format is not exactly {header}.{payload}.{signature}",
      token
    );
    return null;
  }
  if (secretKey) {
    const signature = crypto
      .createHmac("sha256", secretKey)
      .update(`${headerBase64}.${payloadBase64}`)
      .digest("base64");
    if (signature !== signatureBase64) {
      console.debug("Invalid JWT: invalid signature");
      return null;
    }
  }
  try {
    const parsedPayload = JSON.parse(
      Buffer.from(payloadBase64, "base64").toString("utf8")
    ) as unknown;
    return parsedPayload;
  } catch (err) {
    console.debug("Invalid JWT: could not parse payload", err);
    return null;
  }
}

export function getExpire(): number {
  return Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 4; // 4 days
}

const jwtHeader = {
  alg: "HS256",
  typ: "JWT",
};

const jwtHeaderBase64 = Buffer.from(JSON.stringify(jwtHeader)).toString(
  "base64"
);

export function encodeJwt(payload: object, sessionKey: string): string {
  // NOTE: this is only used for authentication, not for authorization (i.e. what a user can do) - this is handled when actually doing operations
  const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString("base64");
  return `${jwtHeaderBase64}.${payloadBase64}.${crypto
    .createHmac("sha256", sessionKey)
    .update(`${jwtHeaderBase64}.${payloadBase64}`)
    .digest("base64")}`;
}
