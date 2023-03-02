import crypto from "crypto";
import { z } from "zod";

const JwtPayload = z.object({
  sub: z.string(),
  exp: z.number(),
  token: z.string(),
  org: z.string(),
  project: z.string(),
});
export type JwtPayload = z.infer<typeof JwtPayload>;

export function decodeJwt(
  token: string,
  sessionKey: string
): JwtPayload | null {
  const [headerBase64, payloadBase64, signatureBase64, ...rest] =
    token.split(".");
  if (!headerBase64 || !payloadBase64 || !signatureBase64 || rest.length > 0) {
    console.debug(
      "Invalid cookie: format is not exactly {header}.{payload}.{signature}",
      token
    );
    return null;
  }
  const signature = crypto
    .createHmac("sha256", sessionKey)
    .update(`${headerBase64}.${payloadBase64}`)
    .digest("base64");
  if (signature !== signatureBase64) {
    console.debug("Invalid cookie: invalid signature");
    return null;
  }
  try {
    const parsedPayload = JSON.parse(
      Buffer.from(payloadBase64, "base64").toString("utf8")
    ) as unknown;
    const payloadVerification = JwtPayload.safeParse(parsedPayload);
    if (!payloadVerification.success) {
      console.debug(
        "Invalid cookie: schema mismatch",
        payloadVerification.error
      );
      return null;
    }
    return payloadVerification.data;
  } catch (err) {
    console.debug("Invalid cookie: could not parse payload", err);
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

export function encodeJwt(payload: JwtPayload, sessionKey: string): string {
  // NOTE: this is only used for authentication, not for authorization (i.e. what a user can do) - this is handled when actually doing operations
  const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString("base64");
  return `${jwtHeaderBase64}.${payloadBase64}.${crypto
    .createHmac("sha256", sessionKey)
    .update(`${jwtHeaderBase64}.${payloadBase64}`)
    .digest("base64")}`;
}
