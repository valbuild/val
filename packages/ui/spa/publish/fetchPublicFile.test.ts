import {
  fetchLiveStylesheet,
  fetchPublicFile,
  siteOriginOf,
  toBase64,
} from "./fetchPublicFile";

describe("fetchPublicFile", () => {
  test("reads the path from this origin and answers base64", async () => {
    const asked: string[] = [];
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const out = await fetchPublicFile("val/a.png", async (url) => {
      asked.push(String(url));
      return new Response(bytes);
    });
    expect(asked).toEqual(["/val/a.png"]);
    expect(out).toBe(Buffer.from(bytes).toString("base64"));
  });

  test("a file the site does not serve is an error, not an empty file", async () => {
    await expect(
      fetchPublicFile(
        "gone.png",
        async () => new Response("", { status: 404 }),
      ),
    ).rejects.toThrow(/404/);
  });

  test("an image-sized file does not overflow the stack", () => {
    const big = new Uint8Array(3_000_000).map((_, i) => i % 256);
    expect(toBase64(big)).toBe(Buffer.from(big).toString("base64"));
  });
});

const at = (href: string) => {
  const url = new URL(href);
  return { protocol: url.protocol, host: url.host, origin: url.origin };
};
const PROPOSAL = "https://c110109f8a3f076b1765--5fa45b9.valstart.dev/val";

describe("siteOriginOf", () => {
  test("a proposal's address names its site by the project", () => {
    expect(siteOriginOf(at(PROPOSAL))).toBe("https://5fa45b9.valstart.dev");
  });

  test("the site's own address, or a custom domain, is the site", () => {
    expect(siteOriginOf(at("https://5fa45b9.valstart.dev/val"))).toBe(
      "https://5fa45b9.valstart.dev",
    );
    expect(siteOriginOf(at("https://www.acme.com/val"))).toBe(
      "https://www.acme.com",
    );
    expect(siteOriginOf(at("http://localhost:3000/val"))).toBe(
      "http://localhost:3000",
    );
  });

  test("a project whose name has '--' in it is not a proposal", () => {
    expect(siteOriginOf(at("https://my--site.valstart.dev"))).toBe(
      "https://my--site.valstart.dev",
    );
  });

  test("a bare proposal label does not say whose proposal it is", () => {
    expect(siteOriginOf(at("https://c110109f8a3f076b1765.valstart.dev"))).toBe(
      null,
    );
  });
});

describe("fetchLiveStylesheet", () => {
  const answering = (status: number, body = "") => {
    const asked: Array<{ url: string; credentials?: RequestCredentials }> = [];
    const fetchImpl = async (url: RequestInfo | URL, init?: RequestInit) => {
      asked.push({ url: String(url), credentials: init?.credentials });
      return new Response(status === 404 ? "" : body, { status });
    };
    return { asked, fetchImpl };
  };

  test("on a proposal's preview, reads the SITE's stylesheet, not the proposal's", async () => {
    // The proposal's own was empty once one of its builds was, and carrying
    // it forward made every rebuild of it empty too.
    const { asked, fetchImpl } = answering(200, ".site{}");
    expect(await fetchLiveStylesheet(fetchImpl, at(PROPOSAL))).toBe(".site{}");
    expect(asked).toEqual([
      { url: "https://5fa45b9.valstart.dev/_app/app.css", credentials: "omit" },
    ]);
  });

  test("on the site, reads this origin's, with its cookies", async () => {
    const { asked, fetchImpl } = answering(200, ".site{}");
    await fetchLiveStylesheet(
      fetchImpl,
      at("https://5fa45b9.valstart.dev/val"),
    );
    expect(asked).toEqual([
      { url: "/_app/app.css", credentials: "same-origin" },
    ]);
  });

  test("a site that serves none is none", async () => {
    const { fetchImpl } = answering(404);
    expect(await fetchLiveStylesheet(fetchImpl, at(PROPOSAL))).toBe("");
  });

  test("a stylesheet that could not be read is an error, never an empty stylesheet", async () => {
    const { fetchImpl } = answering(503);
    await expect(fetchLiveStylesheet(fetchImpl, at(PROPOSAL))).rejects.toThrow(
      /could not be read.*503.*Try again/,
    );
  });

  test("a page that does not say whose proposal it is cannot read it", async () => {
    const { asked, fetchImpl } = answering(200, ".site{}");
    await expect(
      fetchLiveStylesheet(
        fetchImpl,
        at("https://c110109f8a3f076b1765.valstart.dev/val"),
      ),
    ).rejects.toThrow(/does not say which site/);
    expect(asked).toEqual([]);
  });
});

describe("fetchPublicFile on a proposal's preview", () => {
  test("reads the site's file, not the proposal's", async () => {
    const asked: string[] = [];
    await fetchPublicFile(
      "favicon.ico",
      async (url) => {
        asked.push(String(url));
        return new Response(new Uint8Array([1]));
      },
      at(PROPOSAL),
    );
    expect(asked).toEqual(["https://5fa45b9.valstart.dev/favicon.ico"]);
  });
});
