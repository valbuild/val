import crypto from "crypto";

export type JwtPayload = {
  sub: string;
  exp: number;
  token: string;
  org: string;
  project: string;
};

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
    const payload = JSON.parse(
      Buffer.from(payloadBase64, "base64").toString("utf8")
    ) as unknown;
    if (typeof payload !== "object" || payload === null) {
      console.debug("Invalid cookie: could not parse payload");
      return null;
    }
    if (
      "sub" in payload &&
      "token" in payload &&
      "org" in payload &&
      "project" in payload &&
      "exp" in payload
    ) {
      const { sub, token, org, project, exp } = payload;
      if (typeof sub !== "string") {
        console.debug(
          "Invalid cookie: invalid payload (sub was not a string)",
          payload
        );
        return null;
      }
      if (typeof token !== "string") {
        console.debug(
          "Invalid cookie: invalid payload (token was not a string)",
          payload
        );
        return null;
      }
      if (typeof org !== "string") {
        console.debug(
          "Invalid cookie: invalid payload (org was not a string)",
          payload
        );
        return null;
      }
      if (typeof project !== "string") {
        console.debug(
          "Invalid cookie: invalid payload (project was not a string)",
          payload
        );
        return null;
      }
      if (typeof exp !== "number") {
        console.debug(
          "Invalid cookie: invalid payload (exp was not a number)",
          payload
        );
        return null;
      }
      if (exp < Math.floor(Date.now() / 1000)) {
        console.debug("Invalid cookie: expired", payload);
        return null;
      }
      return { sub, token, org, project, exp };
    } else {
      console.debug(
        "Invalid cookie: invalid payload (missing required fields: sub, token, org, project, exp)",
        payload
      );
      return null;
    }
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
