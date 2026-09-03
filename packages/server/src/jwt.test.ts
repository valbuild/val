import crypto from "crypto";
import {
  decodeJwtWithoutVerifying,
  encodeJwt,
  getExpire,
  verifyJwt,
} from "./jwt";

const SECRET = "a-test-secret";
const OTHER_SECRET = "a-different-test-secret";

function payload(overrides: Record<string, unknown> = {}) {
  return {
    sub: "profile-id",
    exp: getExpire(),
    org: "an-org",
    project: "a-project",
    ...overrides,
  };
}

function base64(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64");
}

/** Build a token with an arbitrary header, signed correctly for that header. */
function signWith(header: unknown, body: unknown, secret: string): string {
  const headerBase64 = base64(header);
  const payloadBase64 = base64(body);
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${headerBase64}.${payloadBase64}`)
    .digest("base64");
  return `${headerBase64}.${payloadBase64}.${signature}`;
}

describe("verifyJwt", () => {
  test("round trips a token it signed itself", () => {
    const body = payload();
    const res = verifyJwt(encodeJwt(body, SECRET), SECRET);
    expect(res).toEqual({ success: true, data: body });
  });

  test("keeps payload fields beyond the base shape", () => {
    const body = payload({ token: "the-val-build-token" });
    const res = verifyJwt(encodeJwt(body, SECRET), SECRET);
    expect(res.success && res.data.token).toBe("the-val-build-token");
  });

  test("rejects a token signed with a different secret", () => {
    const token = encodeJwt(payload(), OTHER_SECRET);
    expect(verifyJwt(token, SECRET)).toMatchObject({
      success: false,
      reason: "invalid-signature",
    });
  });

  test("rejects a token whose payload was swapped after signing", () => {
    const [header, , signature] = encodeJwt(
      payload({ sub: "victim" }),
      SECRET,
    ).split(".");
    const tampered = `${header}.${base64(payload({ sub: "attacker" }))}.${signature}`;
    expect(verifyJwt(tampered, SECRET)).toMatchObject({
      success: false,
      reason: "invalid-signature",
    });
  });

  // This is the whole point of the signature: without a secret you must not be
  // able to mint a session, no matter how well-formed the token looks.
  test("rejects an unsigned but otherwise perfect token", () => {
    const [header, body] = encodeJwt(payload(), SECRET).split(".");
    expect(verifyJwt(`${header}.${body}.`, SECRET)).toMatchObject({
      success: false,
      reason: "malformed",
    });
    expect(verifyJwt(`${header}.${body}.notasignature`, SECRET)).toMatchObject({
      success: false,
      reason: "invalid-signature",
    });
  });

  test("refuses to verify without a secret instead of skipping the check", () => {
    const token = encodeJwt(payload(), SECRET);
    expect(verifyJwt(token, "")).toMatchObject({
      success: false,
      reason: "missing-secret",
    });
  });

  test("rejects a token whose signature is the right shape but the wrong bytes", () => {
    const [header, body] = encodeJwt(payload(), SECRET).split(".");
    const wrong = crypto.randomBytes(32).toString("base64");
    expect(verifyJwt(`${header}.${body}.${wrong}`, SECRET)).toMatchObject({
      success: false,
      reason: "invalid-signature",
    });
  });

  describe("expiry", () => {
    test("rejects a token that expired", () => {
      const body = payload({ exp: Math.floor(Date.now() / 1000) - 60 * 60 });
      expect(verifyJwt(encodeJwt(body, SECRET), SECRET)).toMatchObject({
        success: false,
        reason: "expired",
      });
    });

    test("rejects a token that expired a moment ago, once the leeway is past", () => {
      const body = payload({ exp: Math.floor(Date.now() / 1000) - 61 });
      expect(verifyJwt(encodeJwt(body, SECRET), SECRET)).toMatchObject({
        success: false,
        reason: "expired",
      });
    });

    test("accepts a token inside the clock skew leeway", () => {
      const body = payload({ exp: Math.floor(Date.now() / 1000) - 5 });
      expect(verifyJwt(encodeJwt(body, SECRET), SECRET).success).toBe(true);
    });

    test("accepts a token that has not expired", () => {
      const body = payload({ exp: Math.floor(Date.now() / 1000) + 60 });
      expect(verifyJwt(encodeJwt(body, SECRET), SECRET).success).toBe(true);
    });

    // The signature is checked before the payload, so a forged token never gets
    // to claim it is merely expired.
    test("reports a forged expired token as a bad signature, not as expired", () => {
      const body = payload({ exp: Math.floor(Date.now() / 1000) - 60 * 60 });
      expect(verifyJwt(encodeJwt(body, OTHER_SECRET), SECRET)).toMatchObject({
        success: false,
        reason: "invalid-signature",
      });
    });
  });

  describe("header", () => {
    test("rejects alg: none, even with a matching empty signature", () => {
      const headerBase64 = base64({ alg: "none", typ: "JWT" });
      const token = `${headerBase64}.${base64(payload())}.${crypto
        .createHmac("sha256", SECRET)
        .update(`${headerBase64}.${base64(payload())}`)
        .digest("base64")}`;
      expect(verifyJwt(token, SECRET)).toMatchObject({
        success: false,
        reason: "malformed",
      });
    });

    test.each(["HS512", "RS256", "hs256"])("rejects alg: %s", (alg) => {
      const token = signWith({ alg, typ: "JWT" }, payload(), SECRET);
      expect(verifyJwt(token, SECRET)).toMatchObject({
        success: false,
        reason: "malformed",
      });
    });

    test("rejects a non-JWT typ", () => {
      const token = signWith({ alg: "HS256", typ: "JWS" }, payload(), SECRET);
      expect(verifyJwt(token, SECRET)).toMatchObject({
        success: false,
        reason: "malformed",
      });
    });

    test("rejects a header that is not JSON", () => {
      const headerBase64 = Buffer.from("not json").toString("base64");
      const token = `${headerBase64}.${base64(payload())}.sig`;
      expect(verifyJwt(token, SECRET)).toMatchObject({
        success: false,
        reason: "malformed",
      });
    });
  });

  describe("format", () => {
    test.each([
      ["empty", ""],
      ["no dots", "abc"],
      ["two segments", "abc.def"],
      ["four segments", "abc.def.ghi.jkl"],
      ["empty header", ".def.ghi"],
      ["empty payload", "abc..ghi"],
    ])("rejects %s", (_name, token) => {
      expect(verifyJwt(token, SECRET)).toMatchObject({
        success: false,
        reason: "malformed",
      });
    });
  });

  describe("payload", () => {
    test("rejects a payload that is not JSON", () => {
      const headerBase64 = base64({ alg: "HS256", typ: "JWT" });
      const payloadBase64 = Buffer.from("not json").toString("base64");
      const token = `${headerBase64}.${payloadBase64}.${crypto
        .createHmac("sha256", SECRET)
        .update(`${headerBase64}.${payloadBase64}`)
        .digest("base64")}`;
      expect(verifyJwt(token, SECRET)).toMatchObject({
        success: false,
        reason: "malformed",
      });
    });

    test.each([
      ["empty", {}],
      ["no exp", { sub: "s", org: "o", project: "p" }],
      [
        "exp as a string",
        { sub: "s", exp: "9999999999", org: "o", project: "p" },
      ],
      ["no sub", { exp: getExpire(), org: "o", project: "p" }],
      ["no org", { sub: "s", exp: getExpire(), project: "p" }],
    ])("rejects a payload with %s", (_name, body) => {
      expect(verifyJwt(encodeJwt(body, SECRET), SECRET)).toMatchObject({
        success: false,
        reason: "malformed",
      });
    });
  });
});

describe("decodeJwtWithoutVerifying", () => {
  test("returns the payload of a token it cannot verify", () => {
    const body = payload();
    const res = decodeJwtWithoutVerifying(encodeJwt(body, "some-other-key"));
    expect(res).toEqual({ success: true, data: body });
  });

  test("still rejects an expired token", () => {
    const body = payload({ exp: Math.floor(Date.now() / 1000) - 60 * 60 });
    expect(decodeJwtWithoutVerifying(encodeJwt(body, SECRET))).toMatchObject({
      success: false,
      reason: "expired",
    });
  });

  test("still rejects a bad header", () => {
    const token = signWith({ alg: "none", typ: "JWT" }, payload(), SECRET);
    expect(decodeJwtWithoutVerifying(token)).toMatchObject({
      success: false,
      reason: "malformed",
    });
  });

  test("still rejects a payload that is not a Val payload", () => {
    expect(decodeJwtWithoutVerifying(encodeJwt({}, SECRET))).toMatchObject({
      success: false,
      reason: "malformed",
    });
  });
});
