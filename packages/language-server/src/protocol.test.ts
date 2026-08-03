import {
  negotiateProtocolVersion,
  PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  VAL_FEATURES,
} from "./protocol";

describe("negotiateProtocolVersion", () => {
  test("picks the highest version both sides can speak", () => {
    expect(
      negotiateProtocolVersion({ min: 1, max: 3 }, { min: 2, max: 5 }),
    ).toEqual({ status: "ok", protocolVersion: 3 });
  });

  test("succeeds when the ranges only touch at one version", () => {
    expect(
      negotiateProtocolVersion({ min: 1, max: 2 }, { min: 2, max: 4 }),
    ).toEqual({ status: "ok", protocolVersion: 2 });
  });

  test("tells the user to update the client when the server is newer", () => {
    const result = negotiateProtocolVersion(
      { min: 1, max: 2 },
      { min: 3, max: 4 },
    );
    expect(result.status).toBe("client-too-old");
  });

  test("tells the user to update Val when the server is older", () => {
    const result = negotiateProtocolVersion(
      { min: 3, max: 4 },
      { min: 1, max: 2 },
    );
    expect(result.status).toBe("server-too-old");
  });

  test("defaults to this server's supported range", () => {
    expect(negotiateProtocolVersion(SUPPORTED_PROTOCOL_VERSIONS)).toEqual({
      status: "ok",
      protocolVersion: PROTOCOL_VERSION,
    });
  });

  test("a client that only speaks v1 is always supported", () => {
    // The first released client pins { min: 1, max: 1 }. Every future server
    // must keep serving it until we deliberately drop v1 by raising
    // SUPPORTED_PROTOCOL_VERSIONS.min -- which is a breaking change.
    expect(negotiateProtocolVersion({ min: 1, max: 1 }).status).toBe("ok");
  });
});

describe("protocol invariants", () => {
  test("PROTOCOL_VERSION is the top of the supported range", () => {
    expect(SUPPORTED_PROTOCOL_VERSIONS.max).toBe(PROTOCOL_VERSION);
  });

  test("supported range is non-empty", () => {
    expect(SUPPORTED_PROTOCOL_VERSIONS.min).toBeLessThanOrEqual(
      SUPPORTED_PROTOCOL_VERSIONS.max,
    );
  });

  test("feature flags are unique", () => {
    expect(new Set(VAL_FEATURES).size).toBe(VAL_FEATURES.length);
  });
});
