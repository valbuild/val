import pc from "picocolors";
import {
  fetchSiteErrors,
  type SiteError,
  type SiteErrorsAnswer,
} from "@valbuild/server";
import {
  describeValBuildFailure,
  resolveValBuildTarget,
} from "./valBuildTarget";

/**
 * `val errors`: what the hosted site has thrown, warned or been stopped for in
 * the last days, grouped, newest first. Read from Val Build, which keeps them
 * for sites it hosts (`fetchSiteErrors` in @valbuild/server).
 *
 * Authenticates as the developer with the `val login` token, else with the
 * project's VAL_API_KEY. Read-only, and it exits 0 whatever it finds: it
 * answers a question, it does not judge the site.
 */
export async function errors(options: {
  root?: string;
  limit?: number;
  json?: boolean;
  verbose?: boolean;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const read = await readSiteErrors(options);
  if (read.status === "error") {
    console.error(pc.red("val errors: ") + read.message);
    process.exitCode = 1;
    return;
  }
  if (options.json) {
    console.log(JSON.stringify(read.answer, null, 2));
    return;
  }
  console.log(
    formatSiteErrors(read.answer, {
      project: read.project,
      now: Date.now(),
      verbose: options.verbose ?? false,
    }),
  );
}

export type ReadSiteErrors =
  | { status: "ok"; project: string; answer: SiteErrorsAnswer }
  | { status: "error"; message: string };

export async function readSiteErrors(options: {
  root?: string;
  limit?: number;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<ReadSiteErrors> {
  if (
    options.limit !== undefined &&
    (!Number.isInteger(options.limit) ||
      options.limit < 1 ||
      options.limit > 200)
  ) {
    return {
      status: "error",
      message: "--limit takes a whole number from 1 to 200.",
    };
  }
  const resolved = await resolveValBuildTarget({ ...options, what: "errors" });
  if (resolved.status === "error") return resolved;
  const { target } = resolved;
  const result = await fetchSiteErrors({
    contentUrl: target.contentHost,
    project: target.project,
    credential: target.credential,
    ...(options.limit !== undefined ? { limit: options.limit } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
  if (result.status === "ok") {
    return { status: "ok", project: target.project, answer: result.answer };
  }
  return {
    status: "error",
    message: describeValBuildFailure(
      target,
      result.reason,
      result.message,
      "errors",
    ),
  };
}

export function formatSiteErrors(
  answer: SiteErrorsAnswer,
  options: { project: string; now: number; verbose: boolean },
): string {
  if (answer.status === "not-hosted") {
    return `${options.project} is not hosted by Val Build, so its server errors are in its own host's logs.`;
  }
  if (answer.errors.length === 0) {
    return pc.green(
      `No errors on ${options.project} in the last ${answer.retentionDays} days.`,
    );
  }
  const lines = [
    `${answer.errors.length} ${answer.errors.length === 1 ? "error" : "errors"} on ${options.project} in the last ${answer.retentionDays} days, newest first`,
    "",
  ];
  for (const error of answer.errors) {
    lines.push(...formatError(error, answer.liveBuild, options), "");
  }
  lines.push(
    pc.dim(
      "Errors and warnings from the site's server, grouped. console.log is not kept." +
        (answer.dropped
          ? " Some older errors were dropped to keep the list short."
          : "") +
        (options.verbose ? "" : " --verbose shows stacks."),
    ),
  );
  return lines.join("\n");
}

function formatError(
  error: SiteError,
  liveBuild: string | null,
  options: { now: number; verbose: boolean },
): string[] {
  const marker = error.level === "warn" ? pc.yellow("▲") : pc.red("●");
  const isNew = liveBuild !== null && error.firstBuild === liveBuild;
  const head = [
    kindLabel(error),
    `${error.count}×`,
    ago(error.lastSeen, options.now),
    ...(isNew ? [pc.yellow("new in this publish")] : []),
  ].join(pc.dim(" · "));
  const where = [error.method, error.path].filter(Boolean).join(" ");
  const status =
    error.status !== null && error.status >= 400 ? ` · ${error.status}` : "";
  const lines = [`${marker} ${head}`, `  ${error.message}`];
  if (where) lines.push(pc.dim(`  ${where}${status}`));
  if (error.proposal !== null) {
    lines.push(pc.dim(`  at proposal ${error.proposal}`));
  }
  if (options.verbose && error.stack !== null) {
    for (const line of error.stack.split("\n")) {
      if (line.trim() !== "") lines.push(pc.dim(`    ${line.trim()}`));
    }
  }
  return lines;
}

function kindLabel(error: SiteError): string {
  switch (error.kind) {
    case "exception":
      return "Uncaught error";
    case "console":
      return error.level === "warn" ? "Warning" : "Logged error";
    case "limit":
      return "Stopped by the server";
    case "status":
      return "Server error";
  }
}

function ago(iso: string, now: number): string {
  const elapsed = now - Date.parse(iso);
  if (!(elapsed >= 60_000)) return "just now";
  const format = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, ms] of [
    ["day", 24 * 60 * 60_000],
    ["hour", 60 * 60_000],
    ["minute", 60_000],
  ] as const) {
    if (elapsed >= ms) return format.format(-Math.floor(elapsed / ms), unit);
  }
  return "just now";
}
