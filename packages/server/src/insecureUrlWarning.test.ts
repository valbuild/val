import { insecureUrlWarning } from "./ValRouter";

describe("insecureUrlWarning", () => {
  test.each([
    "https://admin.val.build",
    "https://admin.val.build/",
    "https://val.internal.example.com:8443",
  ])("accepts https: %s", (url) => {
    expect(insecureUrlWarning("valBuildUrl", url)).toBeNull();
  });

  // A val.build running on the developer's own machine: there is no network
  // path to be on the wrong side of.
  test.each([
    "http://localhost:3000",
    "http://127.0.0.1:4000",
    "http://[::1]:4000",
    "http://val.localhost:3000",
  ])("accepts loopback over http: %s", (url) => {
    expect(insecureUrlWarning("valBuildUrl", url)).toBeNull();
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

  test("warns for valContentUrl too, naming that option", () => {
    const warning = insecureUrlWarning(
      "valContentUrl",
      "http://content.example.com",
    );
    expect(warning).toContain("valContentUrl");
  });

  test("warns on a URL that does not parse", () => {
    expect(insecureUrlWarning("valBuildUrl", "not a url")).toContain(
      "not a valid URL",
    );
  });

  test.each(["ftp://admin.val.build", "ws://admin.val.build"])(
    "warns on a non-http(s) scheme: %s",
    (url) => {
      expect(insecureUrlWarning("valBuildUrl", url)).toContain("not https");
    },
  );

  test("the default is not warned about", () => {
    expect(
      insecureUrlWarning("valBuildUrl", "https://admin.val.build"),
    ).toBeNull();
  });
});
