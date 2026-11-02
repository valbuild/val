import { VAL_CLIENT_HEADER, valClientHeaders } from "./valClientHeader";

describe("valClientHeaders", () => {
  test("is a product token: the package, then its version", () => {
    expect(valClientHeaders("@valbuild/server", "0.152.0")).toEqual({
      "x-val-client": "@valbuild/server@0.152.0",
    });
    expect(VAL_CLIENT_HEADER).toBe("x-val-client");
  });

  test("a version that could not be read is sent, as unknown", () => {
    expect(valClientHeaders("@valbuild/cli", null)).toEqual({
      "x-val-client": "@valbuild/cli@unknown",
    });
    expect(valClientHeaders("@valbuild/cli", "")).toEqual({
      "x-val-client": "@valbuild/cli@unknown",
    });
  });
});
