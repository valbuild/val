import {
  fetchSiteLogs,
  siteLogRequestLevel,
  type SiteLogRequest,
} from "./siteLogs";

const request = {
  id: "ray1",
  time: "2026-11-26T12:00:00.000Z",
  method: "GET",
  path: "/blog/hello",
  status: 500,
  durationMs: 90,
  cpuMs: 5,
  outcome: "ok",
  build: "b1",
  proposal: null,
  lines: [
    {
      time: "2026-11-26T12:00:00.050Z",
      level: "error",
      message: "Render failed",
      stack: null,
    },
  ],
  errorFingerprint: null,
};
const answer = {
  status: "ok",
  requests: [request],
  cursor: "41",
  histogram: {
    start: "2026-11-26T11:00:00.000Z",
    bucketMs: 60_000,
    buckets: [{ error: 1, warn: 0, info: 0 }],
  },
  liveBuild: "b1",
  retentionHours: 1,
  truncated: false,
};

function answering(status: number, body: unknown) {
  const urls: URL[] = [];
  const headers: Record<string, string>[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    urls.push(new URL(String(input)));
    headers.push(Object.fromEntries(new Headers(init?.headers).entries()));
    return new Response(JSON.stringify(body), { status });
  };
  return { fetchImpl, urls, headers };
}

describe("fetchSiteLogs", () => {
  test("asks for the project's logs with what was asked, and reads the answer", async () => {
    const { fetchImpl, urls, headers } = answering(200, answer);
    const result = await fetchSiteLogs({
      contentUrl: "https://content.val.build",
      project: "acme/site",
      credential: { pat: "pat-1" },
      since: new Date("2026-11-26T11:45:00.000Z"),
      after: "40",
      q: " status:5xx ",
      levels: ["error", "warn"],
      limit: 50,
      live: true,
      fetchImpl,
    });
    expect(result).toEqual({ status: "ok", answer });
    expect(urls[0]?.pathname).toBe("/v1/acme/site/logs");
    expect(Object.fromEntries(urls[0]?.searchParams ?? [])).toEqual({
      since: "2026-11-26T11:45:00.000Z",
      after: "40",
      q: "status:5xx",
      levels: "error,warn",
      limit: "50",
      live: "1",
    });
    expect(headers[0]?.["x-val-pat"]).toBe("pat-1");
  });

  test("with the project's API key, as a bearer token, and nothing more asked", async () => {
    const { fetchImpl, urls, headers } = answering(200, {
      status: "not-hosted",
    });
    const result = await fetchSiteLogs({
      contentUrl: "https://content.val.build/",
      project: "acme/site",
      credential: { apiKey: "key-1" },
      fetchImpl,
    });
    expect(result).toEqual({ status: "ok", answer: { status: "not-hosted" } });
    expect(urls[0]?.search).toBe("");
    expect(headers[0]?.["authorization"]).toBe("Bearer key-1");
  });

  test("says why there is no answer", async () => {
    const reasons: string[] = [];
    const cases: Array<[number, unknown]> = [
      [401, {}],
      [403, {}],
      [404, {}],
      [502, { message: "Try again." }],
      [200, { status: "ok" }],
    ];
    for (const [status, body] of cases) {
      const { fetchImpl } = answering(status, body);
      const result = await fetchSiteLogs({
        contentUrl: "https://content.val.build",
        project: "acme/site",
        credential: { pat: "p" },
        fetchImpl,
      });
      reasons.push(result.status === "error" ? result.reason : "ok");
    }
    expect(reasons).toEqual([
      "unauthenticated",
      "forbidden",
      "not-found",
      "unavailable",
      "invalid-response",
    ]);
  });
});

describe("siteLogRequestLevel", () => {
  test("is the worst thing about a request", () => {
    const base: Pick<SiteLogRequest, "outcome" | "status" | "lines"> = {
      outcome: "ok",
      status: 200,
      lines: [],
    };
    expect(siteLogRequestLevel(base)).toBe("info");
    expect(siteLogRequestLevel({ ...base, status: 502 })).toBe("error");
    expect(
      siteLogRequestLevel({ ...base, outcome: "memory", status: null }),
    ).toBe("error");
    expect(
      siteLogRequestLevel({
        ...base,
        lines: [{ time: "", level: "warn", message: "", stack: null }],
      }),
    ).toBe("warn");
  });
});
