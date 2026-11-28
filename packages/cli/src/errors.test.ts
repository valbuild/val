import os from "os";
import path from "path";
import fs from "fs";
import { formatSiteErrors, readSiteErrors } from "./errors";

/**
 * `val errors`: which credential it sends, what it says when it gets no
 * answer, and how it prints one. Val Build is a fake `fetch`; what it answers
 * is `fetchSiteErrors`'s contract (`@valbuild/server`).
 */

const NOW = Date.UTC(2026, 9, 21, 12);
const error = {
  fingerprint: "0123456789abcdef",
  kind: "console" as const,
  level: "error" as const,
  message: "Render failed: TypeError: x is undefined",
  stack: "TypeError: x is undefined\n    at BlogPost (app.js:1:2)",
  path: "/blog/hello",
  method: "GET",
  status: 500,
  count: 12,
  firstSeen: new Date(NOW - 60 * 60_000).toISOString(),
  lastSeen: new Date(NOW - 5 * 60_000).toISOString(),
  firstBuild: "live",
  lastBuild: "live",
  proposal: null,
};
const warning = {
  ...error,
  fingerprint: "fedcba9876543210",
  level: "warn" as const,
  message: "[val] Could not reach Val Build",
  stack: null,
  status: 200,
  count: 1,
  firstBuild: "older",
};

function root(pat?: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "val-errors-"));
  if (pat !== undefined) {
    fs.mkdirSync(path.join(dir, ".val"));
    fs.writeFileSync(
      path.join(dir, ".val", "pat.json"),
      JSON.stringify({ pat }),
    );
  }
  return dir;
}

function valBuild(status: number, body: unknown) {
  const seen: { url: string; headers: Headers }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    seen.push({ url: String(input), headers: new Headers(init?.headers) });
    return new Response(JSON.stringify(body), { status });
  };
  return { fetchImpl, seen };
}

const env = {
  VAL_PROJECT: "acme/site",
  VAL_CONTENT_URL: "https://content.example",
};

describe("reading them", () => {
  test("asks Val Build as the developer, with their val login", async () => {
    const { fetchImpl, seen } = valBuild(200, { status: "not-hosted" });
    const read = await readSiteErrors({
      root: root("pat-1"),
      limit: 10,
      env: { ...env, VAL_API_KEY: "key-1" },
      fetchImpl,
    });
    expect(read).toEqual({
      status: "ok",
      project: "acme/site",
      answer: { status: "not-hosted" },
    });
    expect(seen[0]?.url).toBe(
      "https://content.example/v1/acme/site/site-errors?limit=10",
    );
    expect(seen[0]?.headers.get("x-val-pat")).toBe("pat-1");
    expect(seen[0]?.headers.get("authorization")).toBeNull();
  });

  test("uses the project's API key when nobody is logged in", async () => {
    const { fetchImpl, seen } = valBuild(200, { status: "not-hosted" });
    await readSiteErrors({
      root: root(),
      env: { ...env, VAL_API_KEY: "key-1" },
      fetchImpl,
    });
    expect(seen[0]?.headers.get("authorization")).toBe("Bearer key-1");
  });

  test("says what to do, and asks nothing, without a credential or a project", async () => {
    const { fetchImpl, seen } = valBuild(200, {});
    expect(
      await readSiteErrors({ root: root(), env, fetchImpl }),
    ).toMatchObject({
      status: "error",
      message: expect.stringContaining("npx val login"),
    });
    expect(
      await readSiteErrors({ root: root("pat-1"), env: {}, fetchImpl }),
    ).toMatchObject({
      status: "error",
      message: expect.stringContaining("val.config"),
    });
    expect(
      await readSiteErrors({ root: root("pat-1"), env, limit: 0, fetchImpl }),
    ).toMatchObject({
      status: "error",
      message: expect.stringContaining("--limit"),
    });
    expect(seen).toEqual([]);
  });

  test("an expired login is told to log in again, and an outage to try again", async () => {
    const expired = valBuild(401, { message: "Unauthorized" });
    expect(
      await readSiteErrors({
        root: root("pat-1"),
        env,
        fetchImpl: expired.fetchImpl,
      }),
    ).toMatchObject({
      status: "error",
      message: expect.stringContaining("Your Val login has expired"),
    });
    const down = valBuild(502, { message: "loader down" });
    const read = await readSiteErrors({
      root: root("pat-1"),
      env,
      fetchImpl: down.fetchImpl,
    });
    expect(read).toMatchObject({
      status: "error",
      message: expect.stringContaining("Trying again"),
    });
    expect(read.status === "error" && read.message).toContain("loader down");
  });
});

describe("printing them", () => {
  // Colour off, so what is compared is the words.
  const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, ""); // eslint-disable-line no-control-regex

  test("newest first, with what this publish brought, where, and how often", () => {
    const text = plain(
      formatSiteErrors(
        {
          status: "ok",
          errors: [error, warning],
          retentionDays: 7,
          liveBuild: "live",
          dropped: false,
        },
        { project: "acme/site", now: NOW, verbose: false },
      ),
    );
    expect(text).toContain("2 errors on acme/site in the last 7 days");
    expect(text).toContain(
      "● Logged error · 12× · 5 minutes ago · new in this publish",
    );
    expect(text).toContain("  GET /blog/hello · 500");
    expect(text).toContain("▲ Warning · 1× · 5 minutes ago\n");
    expect(text).not.toContain("at BlogPost");
  });

  test("stacks with --verbose", () => {
    const text = formatSiteErrors(
      {
        status: "ok",
        errors: [error],
        retentionDays: 7,
        liveBuild: null,
        dropped: false,
      },
      { project: "acme/site", now: NOW, verbose: true },
    );
    expect(text).toContain("at BlogPost (app.js:1:2)");
  });

  test("an empty list and a site served elsewhere say so", () => {
    expect(
      formatSiteErrors(
        {
          status: "ok",
          errors: [],
          retentionDays: 7,
          liveBuild: null,
          dropped: false,
        },
        { project: "acme/site", now: NOW, verbose: false },
      ),
    ).toContain("No errors on acme/site in the last 7 days");
    expect(
      formatSiteErrors(
        { status: "not-hosted" },
        { project: "acme/site", now: NOW, verbose: false },
      ),
    ).toContain("not hosted by Val Build");
  });
});
