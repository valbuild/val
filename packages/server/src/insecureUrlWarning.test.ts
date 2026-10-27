import { insecureUrlWarning } from "./valServerConfig";

describe("insecureUrlWarning", () => {
  test.each([
    "https://admin.val.build",
    "https://admin.val.build/",
    "https://val.internal.example.com:8443",
  ])("accepts https: %s", (url) => {
    expect(insecureUrlWarning("valBuildUrl", url)).toBeNull();
  });

  // NOTE: `URL.hostname` keeps the brackets on an IPv6 literal, so the
  // allowlist entry is "[::1]", not "::1". The bracketed cases below are what
  // stops someone "tidying" the brackets away and silently losing IPv6
  // loopback - the warning would then fire on a developer's own machine.
  test.each([
    "http://localhost:3000",
    "http://127.0.0.1:4000",
    "http://[::1]:4000",
    "http://[::1]",
    "http://[0:0:0:0:0:0:0:1]:4000",
    "http://val.localhost:3000",
  ])("accepts loopback over http: %s", (url) => {
    expect(insecureUrlWarning("valBuildUrl", url)).toBeNull();
  });

  test("an IPv6 loopback literal keeps its brackets in URL.hostname", () => {
    expect(new URL("http://[::1]:4000").hostname).toBe("[::1]");
  });

  test.each([
    "http://admin.val.build",
    "http://val.internal.example.com",
    "http://10.0.0.5:8080",
    // Not loopback: the label only *contains* localhost.
    "http://notlocalhost.example.com",
    "http://localhost.evil.com",
  ])("warns on non-loopback http: %s", (url) => {
    const warning = insecureUrlWarning("valBuildUrl", url);
    expect(warning).toContain("not https");
    expect(warning).toContain(url);
  });

  test.each(["ftp://admin.val.build", "ws://admin.val.build"])(
    "warns on a non-http(s) scheme: %s",
    (url) => {
      expect(insecureUrlWarning("valBuildUrl", url)).toContain("not https");
    },
  );

  test("warns on a URL that does not parse", () => {
    expect(insecureUrlWarning("valBuildUrl", "not a url")).toContain(
      "not a valid URL",
    );
  });

  test("the default is not warned about", () => {
    expect(
      insecureUrlWarning("valBuildUrl", "https://admin.val.build"),
    ).toBeNull();
  });

  describe("wording is specific to the URL", () => {
    test("valBuildUrl names the session cookie it hands back", () => {
      const warning = insecureUrlWarning(
        "valBuildUrl",
        "http://admin.example.com",
      );
      expect(warning).toContain("valBuildUrl");
      expect(warning).toContain("session cookie");
    });

    // There is no session token on this one, so claiming there is would be the
    // message overstating what is at risk.
    test("valContentUrl names the PAT, and does not claim a session token", () => {
      const warning = insecureUrlWarning(
        "valContentUrl",
        "http://content.example.com",
      );
      expect(warning).toContain("valContentUrl");
      expect(warning).toContain("personal access token");
      expect(warning).not.toContain("session cookie");
    });
  });

  // A warning about credentials on the wire must not put a credential into the
  // log while making its point.
  describe("does not leak credentials into the log", () => {
    test("redacts basic-auth userinfo", () => {
      const warning = insecureUrlWarning(
        "valBuildUrl",
        "http://someone:hunter2@admin.example.com:8080/x",
      );
      expect(warning).not.toContain("hunter2");
      expect(warning).not.toContain("someone");
      expect(warning).toContain("credentials redacted");
      // Still names the host, which is the actionable part.
      expect(warning).toContain("admin.example.com:8080");
    });

    test("does not echo a URL that failed to parse", () => {
      const warning = insecureUrlWarning(
        "valBuildUrl",
        "http://user:hunter2@:::",
      );
      expect(warning).toContain("not a valid URL");
      expect(warning).not.toContain("hunter2");
    });

    test("a clean URL is still shown in full", () => {
      expect(
        insecureUrlWarning("valBuildUrl", "http://admin.example.com"),
      ).toContain("http://admin.example.com");
    });
  });
});
