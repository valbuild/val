import { type CiRunReportBody } from "@valbuild/shared/internal";
import { findAndEvalValConfigFile } from "../utils/evalValConfigFile";
import { getContentHost, postJson, ContentHostError } from "./contentHost";
import { resolvePublishCredential } from "./credentials";

/**
 * `val ci-report` -- CI saying how its build of a commit went.
 *
 * The last step of a connected project's workflow, run whether the build
 * passed or not. Content learns a build failed from this and nothing else,
 * so it needs no GitHub permission to tell an editor "Published, not on the
 * site yet: the build failed" (valbuild/home, docs/app-mode.md, "Failures":
 * after the seal). The run's address goes with it, for "View run".
 *
 * Everything has a default from GitHub Actions' own environment -- the
 * commit it checked out, the branch it ran for, the run's URL -- so the step
 * is one line. Never fails the job over a report it could not send: the
 * build's own result is what the job's status is, and a report is advice.
 */
export type CiReport = {
  status: "failed" | "succeeded";
  commit: string;
  branch?: string;
  url?: string;
};

export function ciReportFromEnv(
  options: {
    status: string | undefined;
    commit?: string;
    branch?: string;
    url?: string;
  },
  env: NodeJS.ProcessEnv = process.env,
): { status: "ok"; report: CiReport } | { status: "error"; message: string } {
  const status = options.status;
  if (status !== "failed" && status !== "succeeded") {
    return {
      status: "error",
      message: `--status is "failed" or "succeeded"${status === undefined ? "" : `, not "${status}"`}.`,
    };
  }
  const commit = options.commit ?? env.GITHUB_SHA ?? env.VAL_GIT_COMMIT;
  if (!commit) {
    return {
      status: "error",
      message:
        "No commit to report on: pass --commit, or run this in GitHub Actions (GITHUB_SHA).",
    };
  }
  const branch = options.branch ?? env.GITHUB_REF_NAME ?? env.VAL_GIT_BRANCH;
  const url =
    options.url ??
    (env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID
      ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
      : undefined);
  return {
    status: "ok",
    report: {
      status,
      commit,
      ...(branch ? { branch } : {}),
      ...(url ? { url } : {}),
    },
  };
}

export async function reportCiRun(options: {
  root: string;
  report: CiReport;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<{ status: "reported" } | { status: "error"; message: string }> {
  const env = options.env ?? process.env;
  const config = await findAndEvalValConfigFile(options.root).catch(() => null);
  const credential = await resolvePublishCredential({
    root: options.root,
    project: config?.project ?? env.VAL_PROJECT ?? null,
    env,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
  if (credential.status === "error") {
    return { status: "error", message: credential.message };
  }
  const body: CiRunReportBody = options.report;
  try {
    await postJson({
      url: `${getContentHost(env)}/v1/ci-runs`,
      headers: { Authorization: `Bearer ${credential.credential.token}` },
      body,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });
    return { status: "reported" };
  } catch (e) {
    return {
      status: "error",
      message:
        e instanceof ContentHostError
          ? `Content did not take the report (${e.statusCode}): ${e.message}`
          : e instanceof Error
            ? e.message
            : String(e),
    };
  }
}
