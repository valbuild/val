import os from "os";
import path from "path";
import fs from "fs";
import type { SiteLogRequest, SiteLogsAnswer } from "@valbuild/server";
import { formatRequest, logs, parseOptions } from "./logs";

/**
 * `val logs`: what it asks Val Build, how it prints a request, and how `-f`
 * follows. Val Build is a fake `fetch`; what it answers is `fetchSiteLogs`'s
 * contract (`@valbuild/server`).
 */

const NOW = Date.UTC(2026, 10, 26, 12);

const request = (
  id: string,
  at: number,
  over: Partial<SiteLogRequest> = {},
): SiteLogRequest => ({
  id,
  time: new Date(at).toISOString(),
  method: "GET",
  path: `/${id}`,
  status: 200,
  durationMs: 12,
  cpuMs: 1,
  outcome: "ok",
  build: "b1",
  proposal: null,
  lines: [],
  errorFingerprint: null,
  ...over,
});

const answer = (
  requests: SiteLogRequest[],
  cursor: string,
): SiteLogsAnswer => ({
  status: "ok",
  requests,
  cursor,
  histogram: { start: new Date(NOW).toISOString(), bucketMs: 1, buckets: [] },
  liveBuild: "b1",
  retentionHours: 1,
  truncated: false,
});

function root() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "val-logs-"));
  fs.mkdirSync(path.join(dir, ".val"));
  fs.writeFileSync(
    path.join(dir, ".val", "pat.json"),
    JSON.stringify({ pat: "pat-1" }),
  );
  return dir;
}

const env = {
  VAL_PROJECT: "acme/site",
  VAL_CONTENT_URL: "https://content.example",
};

// eslint-disable-next-line no-control-regex
const plain = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, "");

describe("the options", () => {
  test("since is a duration back from now, the last 15 minutes by default", () => {
    expect(parseOptions({}, NOW)).toMatchObject({
      status: "ok",
      since: new Date(NOW - 15 * 60_000),
      label: "the last 15 minutes",
      levels: ["error", "warn", "info"],
    });
    expect(parseOptions({ since: "30s" }, NOW)).toMatchObject({
      since: new Date(NOW - 30_000),
      label: "the last 30 seconds",
    });
  });

  test("further back than Val Build keeps is said, with where older errors are", () => {
    expect(parseOptions({ since: "2h" }, NOW)).toMatchObject({
      status: "error",
      message: expect.stringContaining("npx val errors"),
    });
  });

  test("levels are the known ones, and anything else says what is", () => {
    expect(parseOptions({ level: "error, warn" }, NOW)).toMatchObject({
      levels: ["error", "warn"],
    });
    expect(parseOptions({ level: "fatal" }, NOW)).toMatchObject({
      status: "error",
      message: expect.stringContaining("error, warn or info"),
    });
    expect(parseOptions({ since: "yesterday-ish" }, NOW)).toMatchObject({
      status: "error",
    });
  });
});

describe("a request, printed", () => {
  test("is a line, and what it printed under it, at its offset", () => {
    const text = plain(
      formatRequest(
        request("blog", NOW, {
          status: 500,
          lines: [
            {
              time: new Date(NOW + 89).toISOString(),
              level: "error",
              message: "Render failed",
              stack: "TypeError: x\n    at Post (app.js:1:2)",
            },
          ],
        }),
        false,
      ),
    );
    const [head, line, more] = text.split("\n");
    expect(head).toMatch(
      /^\d\d:\d\d:\d\d\.\d{3} {2}500 {3}GET \/blog {2}12 ms$/,
    );
    expect(line).toMatch(/\+89 ms\s+error Render failed$/);
    expect(more).toBeUndefined();
  });

  test("with --verbose, its stack; without a status, why", () => {
    const text = plain(
      formatRequest(
        request("search", NOW, {
          status: null,
          outcome: "cpu",
          lines: [
            {
              time: new Date(NOW).toISOString(),
              level: "error",
              message: "x",
              stack: "TypeError: x\n    at Post (app.js:1:2)",
            },
          ],
        }),
        true,
      ),
    );
    expect(text).toContain("stopped: CPU limit");
    expect(text).toContain("at Post (app.js:1:2)");
  });
});

describe("val logs", () => {
  test("prints the range oldest first, newest at the prompt", async () => {
    const out: string[] = [];
    const seen: URL[] = [];
    await logs({
      root: root(),
      env,
      now: () => NOW,
      print: (line) => out.push(plain(line)),
      fetchImpl: async (input) => {
        seen.push(new URL(String(input)));
        return Response.json(
          answer([request("new", NOW - 1000), request("old", NOW - 5000)], "9"),
        );
      },
    });
    expect(out[0]).toContain("acme/site: 2 requests in the last 15 minutes");
    expect(out.slice(1).map((line) => line.split("  ")[2]?.trim())).toEqual([
      "GET /old",
      "GET /new",
    ]);
    expect(seen[0]?.searchParams.get("live")).toBeNull();
  });

  test("-f tells Val Build it is watched, and prints what arrives after the cursor", async () => {
    const out: string[] = [];
    const seen: URL[] = [];
    const controller = new AbortController();
    const answers = [
      answer([request("first", NOW - 1000)], "1"),
      // A late send: an older request, arriving after a newer one.
      answer([request("b", NOW + 2000), request("late", NOW - 3000)], "3"),
      answer([], "3"),
    ];
    let sleeps = 0;
    await logs({
      root: root(),
      env,
      follow: true,
      now: () => NOW,
      print: (line) => out.push(plain(line)),
      signal: controller.signal,
      sleep: async () => {
        sleeps += 1;
        if (sleeps === 3) controller.abort();
      },
      fetchImpl: async (input) => {
        seen.push(new URL(String(input)));
        return Response.json(answers.shift() ?? answer([], "3"));
      },
    });
    expect(seen.map((url) => url.searchParams.get("live"))).toEqual([
      "1",
      "1",
      "1",
    ]);
    expect(seen.map((url) => url.searchParams.get("after"))).toEqual([
      null,
      "1",
      "3",
    ]);
    expect(out[0]).toContain("following");
    expect(out.slice(1).map((line) => line.split("  ")[2]?.trim())).toEqual([
      "GET /first",
      "GET /late",
      "GET /b",
    ]);
  });

  test("a site Val Build does not host is said to be", async () => {
    const out: string[] = [];
    await logs({
      root: root(),
      env,
      now: () => NOW,
      print: (line) => out.push(line),
      fetchImpl: async () => Response.json({ status: "not-hosted" }),
    });
    expect(out).toEqual([
      "acme/site is not hosted by Val Build, so its requests are in its own host's logs.",
    ]);
  });
});
