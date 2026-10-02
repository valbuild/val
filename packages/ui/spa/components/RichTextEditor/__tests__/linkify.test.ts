import { buildSchema } from "../schema";
import { parseEditorDocument } from "../serialize/parseEditorDocument";
import {
  findUrlsInText,
  isSingleUrl,
  resolveUrl,
  scanLinks,
  type LinkContext,
} from "../linkify";
import type { EditorDocument } from "../types";

const schema = buildSchema();

const site: LinkContext = {
  siteOrigins: ["https://blank.no"],
  routes: ["/", "/jobb", "/om-oss/æ", "/blogs/blog1", "https://nav.no/"],
  allowedHrefs: undefined,
};

/** `s.richtext({ a: true })`: the catalog is the project's routes. */
const routeLinks: LinkContext = {
  ...site,
  allowedHrefs: ["/", "/jobb", "https://nav.no/"],
};

describe("findUrlsInText", () => {
  test("stops before the punctuation the sentence put after it", () => {
    expect(
      findUrlsInText("Se https://nav.no/a. Og (https://ssb.no/b), takk!").map(
        (found) => found.url,
      ),
    ).toEqual(["https://nav.no/a", "https://ssb.no/b"]);
  });

  test("keeps a closing bracket the URL opened", () => {
    expect(
      findUrlsInText("https://en.wikipedia.org/wiki/Foo_(bar) er fin").map(
        (found) => found.url,
      ),
    ).toEqual(["https://en.wikipedia.org/wiki/Foo_(bar)"]);
  });

  test("needs a scheme: www. and paths are ordinary text", () => {
    expect(findUrlsInText("www.nav.no og /jobb")).toEqual([]);
  });

  test("finds ftp, and not mailto", () => {
    expect(
      findUrlsInText("ftp://files.example.com/x mailto:a@b.no").map(
        (found) => found.url,
      ),
    ).toEqual(["ftp://files.example.com/x"]);
  });

  test("offsets point at the URL", () => {
    const [found] = findUrlsInText("Les https://nav.no nå");
    expect(found).toEqual({ start: 4, end: 18, url: "https://nav.no" });
  });
});

describe("isSingleUrl", () => {
  test("one URL, surrounding whitespace allowed", () => {
    expect(isSingleUrl("  https://nav.no/x\n")).toBe(true);
  });
  test("prose containing a URL is not one", () => {
    expect(isSingleUrl("se https://nav.no")).toBe(false);
    expect(isSingleUrl("https://nav.no.")).toBe(false);
  });
});

describe("resolveUrl", () => {
  test("an external URL links to itself", () => {
    expect(resolveUrl("https://ssb.no/statistikk", site)).toEqual({
      status: "linkable",
      href: "https://ssb.no/statistikk",
      internal: false,
    });
  });

  test("a URL on this site becomes the internal link", () => {
    expect(resolveUrl("https://blank.no/jobb", site)).toEqual({
      status: "linkable",
      href: "/jobb",
      internal: true,
    });
  });

  test("www., http and a trailing slash are still this site", () => {
    expect(resolveUrl("http://www.blank.no/jobb/", site)).toEqual({
      status: "linkable",
      href: "/jobb",
      internal: true,
    });
  });

  test("a percent-encoded path finds the route spelled in plain text", () => {
    expect(resolveUrl("https://blank.no/om-oss/%C3%A6", site)).toEqual({
      status: "linkable",
      href: "/om-oss/æ",
      internal: true,
    });
  });

  test("the query and hash are kept when any href is allowed", () => {
    expect(resolveUrl("https://blank.no/jobb?ref=x#søk", site)).toMatchObject({
      href: "/jobb?ref=x#s%C3%B8k",
    });
  });

  test("a page on this site that does not exist is missing, not a link", () => {
    expect(resolveUrl("https://blank.no/finnes-ikke", site)).toEqual({
      status: "missing-page",
      path: "/finnes-ikke",
    });
  });

  test("a project without routes cannot say a page is missing", () => {
    expect(
      resolveUrl("https://blank.no/hva-som-helst", {
        ...site,
        routes: [],
      }),
    ).toEqual({ status: "linkable", href: "/hva-som-helst", internal: true });
  });

  test("an external router's keys are not pages of this site", () => {
    expect(
      resolveUrl("https://blank.no/x", {
        ...site,
        routes: ["https://nav.no/"],
      }),
    ).toMatchObject({ status: "linkable", href: "/x" });
  });

  test("a port on the site's origin has to match", () => {
    const local: LinkContext = {
      ...site,
      siteOrigins: ["http://localhost:3000"],
    };
    expect(resolveUrl("http://localhost:3000/jobb", local)).toMatchObject({
      href: "/jobb",
    });
    expect(resolveUrl("http://localhost:6006/jobb", local)).toMatchObject({
      href: "http://localhost:6006/jobb",
      internal: false,
    });
  });

  test("ftp is never this site", () => {
    expect(resolveUrl("ftp://blank.no/jobb", site)).toMatchObject({
      internal: false,
    });
  });

  test("anything else is not a URL we link", () => {
    expect(resolveUrl("mailto:hei@blank.no", site)).toBeNull();
    expect(resolveUrl("/jobb", site)).toBeNull();
  });

  describe("with a catalog", () => {
    test("an internal URL links to the route, without the query", () => {
      expect(resolveUrl("https://blank.no/jobb?ref=x", routeLinks)).toEqual({
        status: "linkable",
        href: "/jobb",
        internal: true,
      });
    });

    test("an external URL in the catalog links with the catalog's spelling", () => {
      expect(resolveUrl("https://nav.no", routeLinks)).toEqual({
        status: "linkable",
        href: "https://nav.no/",
        internal: false,
      });
    });

    test("an external URL outside it cannot be linked", () => {
      expect(resolveUrl("https://ssb.no", routeLinks)).toEqual({
        status: "not-allowed",
        href: "https://ssb.no",
        reason: "external",
      });
    });

    test("a page that exists but is outside it cannot be linked", () => {
      expect(resolveUrl("https://blank.no/blogs/blog1", routeLinks)).toEqual({
        status: "not-allowed",
        href: "/blogs/blog1",
        reason: "page",
      });
    });

    test("a page that does not exist is still missing", () => {
      expect(resolveUrl("https://blank.no/nope", routeLinks)).toEqual({
        status: "missing-page",
        path: "/nope",
      });
    });
  });
});

describe("scanLinks", () => {
  const scan = (doc: EditorDocument, ctx: LinkContext = site) =>
    scanLinks(parseEditorDocument(doc, schema), schema, ctx);

  test("finds bare URLs and says what each links to", () => {
    const result = scan([
      {
        tag: "p",
        children: ["Se https://ssb.no og https://blank.no/jobb."],
      },
    ]);
    expect(
      result.fixable.map((finding) => [
        finding.url,
        finding.resolution.status === "linkable" && finding.resolution.href,
      ]),
    ).toEqual([
      ["https://ssb.no", "https://ssb.no"],
      ["https://blank.no/jobb", "/jobb"],
    ]);
    const doc = parseEditorDocument(
      [{ tag: "p", children: ["Se https://ssb.no og https://blank.no/jobb."] }],
      schema,
    );
    for (const finding of result.fixable) {
      expect(doc.textBetween(finding.from, finding.to)).toBe(finding.url);
    }
  });

  test("a URL split across bold and plain text is one URL", () => {
    const result = scan([
      {
        tag: "p",
        children: [
          "https://ssb.no/",
          { tag: "span", styles: ["bold"], children: ["statistikk"] },
        ],
      },
    ]);
    expect(result.fixable.map((finding) => finding.url)).toEqual([
      "https://ssb.no/statistikk",
    ]);
  });

  test("code is left alone", () => {
    const result = scan([
      { tag: "pre", children: ["curl https://ssb.no"] },
      {
        tag: "p",
        children: [
          { tag: "span", styles: ["code"], children: ["https://ssb.no"] },
        ],
      },
    ]);
    expect(result.fixable).toEqual([]);
  });

  test("an existing link to a URL elsewhere is fine", () => {
    const result = scan([
      {
        tag: "p",
        children: [
          { tag: "a", href: "https://ssb.no", children: ["https://ssb.no"] },
        ],
      },
    ]);
    expect(result).toEqual({ fixable: [], missing: [], notAllowed: [] });
  });

  test("an existing link to this site's full address is fixable", () => {
    const result = scan([
      {
        tag: "p",
        children: [
          { tag: "a", href: "https://blank.no/jobb", children: ["jobb"] },
        ],
      },
    ]);
    expect(result.fixable).toMatchObject([
      {
        source: "link",
        url: "https://blank.no/jobb",
        resolution: { status: "linkable", href: "/jobb" },
      },
    ]);
  });

  test("an existing internal link to a page that does not exist is missing", () => {
    const result = scan([
      {
        tag: "p",
        children: [{ tag: "a", href: "/borte", children: ["borte"] }],
      },
    ]);
    expect(result.missing).toMatchObject([
      {
        source: "link",
        resolution: { status: "missing-page", path: "/borte" },
      },
    ]);
  });

  test("a pasted URL to a missing page is missing", () => {
    const result = scan([{ tag: "p", children: ["https://blank.no/borte"] }]);
    expect(result.fixable).toEqual([]);
    expect(result.missing).toMatchObject([{ source: "text" }]);
  });

  test("URLs the field cannot link are reported apart", () => {
    const result = scan(
      [{ tag: "p", children: ["https://ssb.no og https://blank.no/jobb"] }],
      routeLinks,
    );
    expect(result.fixable.map((finding) => finding.url)).toEqual([
      "https://blank.no/jobb",
    ]);
    expect(result.notAllowed.map((finding) => finding.url)).toEqual([
      "https://ssb.no",
    ]);
  });
});
