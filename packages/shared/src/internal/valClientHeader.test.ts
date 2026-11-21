import {
  VAL_API_VERSION,
  VAL_CLIENT_HEADER,
  valClientHeaders,
  valCredentialHeaders,
} from "./valClientHeader";

describe("valClientHeaders", () => {
  test("is a product token: the package, then its version, under both spellings", () => {
    expect(valClientHeaders("@valbuild/server", "0.152.0")).toEqual({
      "val-client": "@valbuild/server@0.152.0",
      "x-val-client": "@valbuild/server@0.152.0",
      "val-version": VAL_API_VERSION,
    });
    expect(VAL_CLIENT_HEADER).toBe("val-client");
  });

  test("a version that could not be read is sent, as unknown", () => {
    expect(valClientHeaders("@valbuild/cli", null)["val-client"]).toBe(
      "@valbuild/cli@unknown",
    );
    expect(valClientHeaders("@valbuild/cli", "")["x-val-client"]).toBe(
      "@valbuild/cli@unknown",
    );
  });

  test("names the contract version as a date", () => {
    expect(VAL_API_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("valCredentialHeaders", () => {
  test("a PAT is a bearer, and in the header a content host from before the contract reads", () => {
    expect(valCredentialHeaders({ pat: "val_pat_abc" })).toEqual({
      Authorization: "Bearer val_pat_abc",
      "val-pat": "val_pat_abc",
      "x-val-pat": "val_pat_abc",
    });
  });

  test("an API key and any other token are a bearer alone", () => {
    expect(valCredentialHeaders({ apiKey: "val_ak_abc" })).toEqual({
      Authorization: "Bearer val_ak_abc",
    });
    expect(valCredentialHeaders({ bearer: "a.b.c" })).toEqual({
      Authorization: "Bearer a.b.c",
    });
  });
});
