import os from "os";
import path from "path";
import fs from "fs";
import { ciReportFromEnv, reportCiRun } from "./reportCiRun";

const actions = {
  GITHUB_SHA: "abc123",
  GITHUB_REF_NAME: "main",
  GITHUB_SERVER_URL: "https://github.com",
  GITHUB_REPOSITORY: "acme/site",
  GITHUB_RUN_ID: "42",
};

describe("what a CI report says", () => {
  test("takes the commit, the branch and the run from GitHub Actions", () => {
    expect(ciReportFromEnv({ status: "failed" }, actions)).toEqual({
      status: "ok",
      report: {
        status: "failed",
        commit: "abc123",
        branch: "main",
        url: "https://github.com/acme/site/actions/runs/42",
      },
    });
  });

  test("a flag wins over the environment", () => {
    const read = ciReportFromEnv(
      { status: "succeeded", commit: "def456", url: "https://ci.example/1" },
      actions,
    );
    expect(read).toMatchObject({
      report: { commit: "def456", url: "https://ci.example/1" },
    });
  });

  test("a status that is neither, or no commit, is refused by name", () => {
    expect(ciReportFromEnv({ status: "passed" }, actions)).toMatchObject({
      status: "error",
      message: expect.stringContaining('"passed"'),
    });
    expect(ciReportFromEnv({ status: "failed" }, {})).toMatchObject({
      status: "error",
      message: expect.stringContaining("GITHUB_SHA"),
    });
  });
});

describe("sending it", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "val-ci-report-"));
  const report = {
    status: "failed" as const,
    commit: "abc123",
    url: "https://github.com/acme/site/actions/runs/42",
  };

  test("posts the report to content with the project token", async () => {
    const sent: { url: string; auth: string | null; body: unknown }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      sent.push({
        url: String(input),
        auth: headers.get("Authorization"),
        body: JSON.parse(String(init?.body)),
      });
      return new Response(JSON.stringify({ recorded: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const result = await reportCiRun({
      root,
      report,
      env: {
        VAL_PROJECT_TOKEN: "val_pt_secret",
        VAL_CONTENT_URL: "https://content.test",
      },
      fetchImpl,
    });
    expect(result).toEqual({ status: "reported" });
    expect(sent).toEqual([
      {
        url: "https://content.test/v1/ci-runs",
        auth: "Bearer val_pt_secret",
        body: report,
      },
    ]);
  });

  test("a refusal is said, not thrown", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ message: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    const result = await reportCiRun({
      root,
      report,
      env: {
        VAL_PROJECT_TOKEN: "val_pt_revoked",
        VAL_CONTENT_URL: "https://content.test",
      },
      fetchImpl,
    });
    expect(result).toMatchObject({
      status: "error",
      message: expect.stringContaining("401"),
    });
  });
});
