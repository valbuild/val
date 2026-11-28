import { fetchSiteErrors } from "./siteErrors";

const kept = {
  fingerprint: "0123456789abcdef",
  kind: "exception",
  level: "error",
  message: "TypeError: x is undefined",
  stack: null,
  path: "/blog/hello",
  method: "GET",
  status: 500,
  count: 3,
  firstSeen: "2026-10-20T00:00:00.000Z",
  lastSeen: "2026-10-21T00:00:00.000Z",
  firstBuild: "b1",
  lastBuild: "b1",
  proposal: null,
};

function answering(status: number, body: unknown) {
  const requests: { url: string; headers: Record<string, string> }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push({
      url: String(input),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
    });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetchImpl, requests };
}

describe("fetchSiteErrors", () => {
  test("asks Val Build for the project's errors with a val login token, and reads the answer", async () => {
    const { fetchImpl, requests } = answering(200, {
      status: "ok",
      errors: [kept],
      retentionDays: 7,
      liveBuild: "b1",
      dropped: false,
    });
    const result = await fetchSiteErrors({
      contentUrl: "https://content.example/",
      project: "acme/site",
      credential: { pat: "pat-1" },
      limit: 20,
      fetchImpl,
    });
    expect(result).toEqual({
      status: "ok",
      answer: {
        status: "ok",
        errors: [kept],
        retentionDays: 7,
        liveBuild: "b1",
        dropped: false,
      },
    });
    expect(requests).toEqual([
      {
        url: "https://content.example/v1/acme/site/site-errors?limit=20",
        headers: { accept: "application/json", "x-val-pat": "pat-1" },
      },
    ]);
  });

  test("sends an API key as a bearer token", async () => {
    const { fetchImpl, requests } = answering(200, { status: "not-hosted" });
    const result = await fetchSiteErrors({
      contentUrl: "https://content.example",
      project: "acme/site",
      credential: { apiKey: "key-1" },
      fetchImpl,
    });
    expect(result).toEqual({
      status: "ok",
      answer: { status: "not-hosted" },
    });
    expect(requests[0]?.headers["authorization"]).toBe("Bearer key-1");
  });

  test("names why it got no answer, with Val Build's own sentence", async () => {
    for (const [status, reason] of [
      [401, "unauthenticated"],
      [403, "forbidden"],
      [404, "not-found"],
      [502, "unavailable"],
    ] as const) {
      const { fetchImpl } = answering(status, { message: `said ${status}` });
      expect(
        await fetchSiteErrors({
          contentUrl: "https://content.example",
          project: "acme/site",
          credential: { pat: "p" },
          fetchImpl,
        }),
      ).toEqual({ status: "error", reason, message: `said ${status}` });
    }
  });

  test("tells no answer from a wrong one", async () => {
    const unreachable = await fetchSiteErrors({
      contentUrl: "https://content.example",
      project: "acme/site",
      credential: { pat: "p" },
      fetchImpl: async () => {
        throw new TypeError("fetch failed");
      },
    });
    expect(unreachable).toMatchObject({
      status: "error",
      reason: "unreachable",
    });
    const { fetchImpl } = answering(200, { errors: "nope" });
    expect(
      await fetchSiteErrors({
        contentUrl: "https://content.example",
        project: "acme/site",
        credential: { pat: "p" },
        fetchImpl,
      }),
    ).toMatchObject({ status: "error", reason: "invalid-response" });
  });
});
