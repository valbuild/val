import crypto from "crypto";
import { z } from "zod";

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

  try {
    const parsedHeader = JSON.parse(
      Buffer.from(headerBase64, "base64").toString("utf8")
    ) as unknown;
    const headerVerification = JwtHeaderSchema.safeParse(parsedHeader);
    if (!headerVerification.success) {
      console.debug("Invalid JWT: invalid header", parsedHeader);
      return null;
    }
    if (headerVerification.data.typ !== jwtHeader.typ) {
      console.debug("Invalid JWT: invalid header typ", parsedHeader);
      return null;
    }
    if (headerVerification.data.alg !== jwtHeader.alg) {
      console.debug("Invalid JWT: invalid header alg", parsedHeader);
      return null;
    }
  } catch (err) {
    console.debug("Invalid JWT: could not parse header", err);
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
