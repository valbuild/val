import {
  checkExternalUrls,
  ExternalUrlIssueCode,
  statusOf,
} from "./externalUrlChecks";
import {
  canonicalExternalUrl,
  parseExternalUrl,
  PHONE_GROUP,
  registrableDomain,
} from "./externalUrls";

/** The codes reported for one URL, checked among the others. */
function codesOf(urls: string[], url: string): ExternalUrlIssueCode[] {
  const issues = checkExternalUrls(urls).get(url);
  if (issues === undefined) {
    throw new Error(`No result for ${url}`);
  }
  return issues.map((issue) => issue.code);
}

describe("registrableDomain", () => {
  test("keeps a bare domain", () => {
    expect(registrableDomain("example.com")).toBe("example.com");
  });

  test("drops the subdomain", () => {
    expect(registrableDomain("status.example.com")).toBe("example.com");
    expect(registrableDomain("a.b.c.example.com")).toBe("example.com");
  });

  test("keeps a shared second level whole", () => {
    expect(registrableDomain("shop.example.co.uk")).toBe("example.co.uk");
    expect(registrableDomain("example.co.uk")).toBe("example.co.uk");
  });
});

describe("parseExternalUrl", () => {
  test("a URL on its own domain shows its path", () => {
    expect(parseExternalUrl("https://instagram.com/valbuild")).toEqual({
      host: "instagram.com",
      group: "instagram.com",
      label: "/valbuild",
      scheme: "https",
    });
  });

  test("a subdomain keeps its host in the label", () => {
    expect(parseExternalUrl("https://status.example.com/x")).toEqual({
      host: "status.example.com",
      group: "example.com",
      label: "status.example.com/x",
      scheme: "https",
    });
  });

  test("a bare domain falls back to its host rather than an empty label", () => {
    expect(parseExternalUrl("https://example.com").label).toBe("example.com");
  });

  test("the label keeps what the checks are about", () => {
    // Each of these used to come out identical to the row beside it, because
    // the label was rebuilt from the parsed URL instead of cut out of the key.
    expect(parseExternalUrl("https://example.com/").label).toBe("/");
    expect(parseExternalUrl("https://portal.example.com/").label).toBe(
      "portal.example.com/",
    );
    expect(parseExternalUrl("http://status.example.com").label).toBe(
      "http://status.example.com",
    );
    expect(
      parseExternalUrl("http://admin:pw@legacy.example.com/reports").label,
    ).toBe("http://admin:pw@legacy.example.com/reports");
    expect(parseExternalUrl("https://example.com:8443/x").label).toBe(
      "example.com:8443/x",
    );
  });

  test("a key that is not a URL is its own group", () => {
    expect(parseExternalUrl("discord.gg/val")).toEqual({
      host: null,
      group: "Not a URL",
      label: "discord.gg/val",
      scheme: null,
    });
  });
});

describe("canonicalExternalUrl", () => {
  test("a trailing slash is not a different page", () => {
    expect(canonicalExternalUrl("https://example.com/x/")).toBe(
      canonicalExternalUrl("https://example.com/x"),
    );
  });

  test("neither is a fragment or the default port", () => {
    expect(canonicalExternalUrl("https://example.com:443/x#top")).toBe(
      canonicalExternalUrl("https://example.com/x"),
    );
  });

  test("but the scheme is", () => {
    expect(canonicalExternalUrl("http://example.com/x")).not.toBe(
      canonicalExternalUrl("https://example.com/x"),
    );
  });

  test("and the query is", () => {
    expect(canonicalExternalUrl("https://example.com/x?a=1")).not.toBe(
      canonicalExternalUrl("https://example.com/x"),
    );
  });
});

describe("parseExternalUrl of a scheme with no host", () => {
  test("a mailto: groups under the domain it writes to", () => {
    // The point of the heading is the organisation, and an address at
    // example.com belongs with that organisation's pages.
    expect(parseExternalUrl("mailto:post@example.com")).toEqual({
      host: null,
      group: "example.com",
      label: "mailto:post@example.com",
      scheme: "mailto",
    });
    expect(parseExternalUrl("mailto:a@status.example.co.uk").group).toBe(
      "example.co.uk",
    );
  });

  test("a mailto: with no address still lands somewhere", () => {
    // A key mid-way through being typed. A heading is all that rides on it.
    expect(parseExternalUrl("mailto:").group).toBe("mailto:");
  });

  test("a tel: gets a heading of its own", () => {
    expect(parseExternalUrl("tel:+4712345678")).toEqual({
      host: null,
      group: PHONE_GROUP,
      label: "tel:+4712345678",
      scheme: "tel",
    });
  });

  test("any other hostless scheme is grouped by the scheme", () => {
    expect(parseExternalUrl("bitcoin:1abc").group).toBe("bitcoin:");
  });

  test("the whole key is the label, since no heading repeats any of it", () => {
    expect(parseExternalUrl("mailto:post@example.com").label).toBe(
      "mailto:post@example.com",
    );
  });
});

describe("checkExternalUrls", () => {
  test("a plain https URL has nothing wrong with it", () => {
    expect(codesOf(["https://example.com/x"], "https://example.com/x")).toEqual(
      [],
    );
  });

  test("a key without a scheme is the error the router raises", () => {
    expect(codesOf(["example.com"], "example.com")).toEqual(["scheme-refused"]);
  });

  test("nothing else is reported for a key that is not a URL", () => {
    // Everything below `scheme-refused` needs a parsed URL, so reporting more
    // would mean guessing at what the author meant.
    expect(codesOf(["  example.com  "], "  example.com  ")).toEqual([
      "whitespace",
      "scheme-refused",
    ]);
  });

  test("mailto: and tel: are ordinary external pages", () => {
    expect(
      codesOf(["mailto:post@example.com"], "mailto:post@example.com"),
    ).toEqual([]);
    expect(codesOf(["tel:+4712345678"], "tel:+4712345678")).toEqual([]);
  });

  test("a scheme that runs code is refused however wide the policy is", () => {
    const url = "javascript:alert(1)";
    expect(codesOf([url], url)).toEqual(["scheme-refused"]);
    expect(
      checkExternalUrls([url], { schemes: ["javascript"] }).get(url),
    ).toHaveLength(1);
  });

  test("a narrowed policy refuses a scheme the wide default allows", () => {
    const url = "mailto:post@example.com";
    expect(checkExternalUrls([url], { schemes: ["https"] }).get(url)).toEqual([
      {
        code: "scheme-refused",
        severity: "error",
        message: expect.stringContaining("https"),
      },
    ]);
  });

  test("the same mailto: twice is a duplicate, like any other key", () => {
    const urls = [
      "mailto:post@example.com",
      "mailto:post@example.com?subject=Hi",
    ];
    // Different keys, different addresses to open - not duplicates.
    expect(codesOf(urls, urls[0])).toEqual([]);
    expect(
      codesOf(
        ["mailto:post@example.com", " mailto:post@example.com"],
        "mailto:post@example.com",
      ),
    ).toEqual(["duplicate"]);
  });

  test("a mailto: is not reported for anything a host would be", () => {
    // No authority means no credentials, no port, no tracking parameters -
    // reporting on them would be inventing a finding about a string that has
    // none of those parts.
    expect(
      codesOf(
        ["mailto:post@localhost?utm_source=x"],
        "mailto:post@localhost?utm_source=x",
      ),
    ).toEqual([]);
  });

  test("credentials in a URL are an error", () => {
    const url = "https://user:pw@example.com/";
    expect(codesOf([url], url)).toContain("credentials");
  });

  test("http is a warning, and says so differently when the https twin is listed", () => {
    const alone = checkExternalUrls(["http://example.com/x"]).get(
      "http://example.com/x",
    );
    expect(alone?.[0].message).toContain("Browsers warn");

    const withTwin = checkExternalUrls([
      "http://example.com/x",
      "https://example.com/x",
    ]).get("http://example.com/x");
    expect(withTwin?.[0].message).toContain("already in the list");
  });

  test("the https twin of an http URL is not itself flagged", () => {
    expect(
      codesOf(
        ["http://example.com/x", "https://example.com/x"],
        "https://example.com/x",
      ),
    ).toEqual([]);
  });

  test("two keys for the same page each name the other", () => {
    const urls = ["https://example.com/x", "https://example.com/x/"];
    expect(codesOf(urls, urls[0])).toEqual(["duplicate"]);
    const issues = checkExternalUrls(urls).get(urls[0]);
    expect(issues?.[0].message).toContain("https://example.com/x/");
  });

  test("a local address warns", () => {
    for (const host of [
      "localhost:3000",
      "127.0.0.1",
      "printer.local",
      "10.0.0.4",
      "192.168.1.9",
      "172.20.0.1",
    ]) {
      const url = `http://${host}/preview`;
      expect(codesOf([url], url)).toContain("local-host");
    }
  });

  test("a public host that merely looks private does not", () => {
    const url = "https://172.15.0.1.example.com/x";
    expect(codesOf([url], url)).not.toContain("local-host");
  });

  test("tracking parameters are named in the message", () => {
    const url = "https://example.com/?utm_source=site&utm_campaign=spring";
    const issues = checkExternalUrls([url]).get(url);
    expect(issues?.map((issue) => issue.code)).toContain("tracking-params");
    expect(
      issues?.find((issue) => issue.code === "tracking-params")?.message,
    ).toContain("utm_source, utm_campaign");
  });

  test("every URL in the list gets an answer", () => {
    const urls = ["https://a.com", "nope", "http://b.com"];
    expect([...checkExternalUrls(urls).keys()]).toEqual(urls);
  });
});

describe("statusOf", () => {
  test("one error outranks any number of warnings", () => {
    expect(
      statusOf([
        { code: "insecure-scheme", severity: "warning", message: "" },
        { code: "scheme-refused", severity: "error", message: "" },
      ]),
    ).toBe("error");
  });

  test("no issues is ok", () => {
    expect(statusOf([])).toBe("ok");
  });
});
