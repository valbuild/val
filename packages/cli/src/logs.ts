import pc from "picocolors";
import {
  fetchSiteLogs,
  siteLogRequestLevel,
  type SiteLogLine,
  type SiteLogRequest,
  type SiteLogRequestLevel,
  type SiteLogsAnswer,
} from "@valbuild/server";
import {
  describeValBuildFailure,
  resolveValBuildTarget,
  type ValBuildTarget,
} from "./valBuildTarget";

/**
 * `val logs`: what the hosted site's server did in the last hour, one request
 * at a time with what it printed, oldest first so the newest is where the
 * prompt is. `-f` follows: it asks Val Build for what arrived every
 * {@link FOLLOW_MS}, and tells it someone is watching, so it gathers requests
 * every few seconds instead of once a minute. Read from Val Build, which keeps
 * them for sites it hosts (`fetchSiteLogs` in @valbuild/server).
 *
 * Authenticates like `val errors`: the `val login` token, else VAL_API_KEY.
 */

/** How often `-f` asks. The Studio's Logs page asks as often. */
export const FOLLOW_MS = 2_000;
const LEVELS: readonly SiteLogRequestLevel[] = ["error", "warn", "info"];
/** What Val Build keeps: asking for more is said, not silently cut. */
const RETENTION_MS = 60 * 60_000;

export type LogsOptions = {
  root?: string;
  /** `15m`, `30s`, `1h`, or an ISO time. The last 15 minutes when absent. */
  since?: string;
  /** `error`, or `error,warn`. All when absent. */
  level?: string;
  /** Val Build's search: words, `status:5xx`, `path:/blog/*`… */
  search?: string;
  limit?: number;
  json?: boolean;
  verbose?: boolean;
  follow?: boolean;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  /** Where lines go: stdout, or a test's array. */
  print?: (line: string) => void;
  /** Stops `-f`. Ctrl-C when absent. */
  signal?: AbortSignal;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  now?: () => number;
};

export async function logs(options: LogsOptions): Promise<void> {
  const print = options.print ?? ((line: string) => console.log(line));
  const now = options.now ?? Date.now;
  const parsed = parseOptions(options, now());
  if (parsed.status === "error") {
    console.error(pc.red("val logs: ") + parsed.message);
    process.exitCode = 1;
    return;
  }
  const resolved = await resolveValBuildTarget({ ...options, what: "logs" });
  if (resolved.status === "error") {
    console.error(pc.red("val logs: ") + resolved.message);
    process.exitCode = 1;
    return;
  }
  const { target } = resolved;
  const ask = (after?: string) =>
    fetchSiteLogs({
      contentUrl: target.contentHost,
      project: target.project,
      credential: target.credential,
      since: parsed.since,
      ...(after !== undefined ? { after } : {}),
      ...(options.search !== undefined ? { q: options.search } : {}),
      levels: parsed.levels,
      ...(options.limit !== undefined ? { limit: options.limit } : {}),
      live: options.follow === true,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });

  const first = await ask();
  if (first.status === "error") {
    console.error(
      pc.red("val logs: ") +
        describeValBuildFailure(target, first.reason, first.message, "logs"),
    );
    process.exitCode = 1;
    return;
  }
  if (first.answer.status === "not-hosted") {
    print(
      `${target.project} is not hosted by Val Build, so its requests are in its own host's logs.`,
    );
    return;
  }
  const answer = first.answer;
  if (options.json && !options.follow) {
    print(JSON.stringify(answer, null, 2));
    return;
  }
  const show = (requests: SiteLogRequest[]) => {
    for (const request of [...requests].reverse()) {
      if (options.json) print(JSON.stringify(request));
      else print(formatRequest(request, options.verbose ?? false));
    }
  };
  if (!options.json) {
    print(pc.dim(headerOf(target, answer, parsed.label, options)));
  }
  show(answer.requests);
  if (!options.follow) {
    if (!options.json && answer.requests.length === 0) {
      print(`No requests in ${parsed.label}.`);
    }
    return;
  }
  await follow(target, answer.cursor, ask, show, options, print);
}

async function follow(
  target: ValBuildTarget,
  cursor: string,
  ask: (after?: string) => ReturnType<typeof fetchSiteLogs>,
  show: (requests: SiteLogRequest[]) => void,
  options: LogsOptions,
  print: (line: string) => void,
): Promise<void> {
  const controller = new AbortController();
  const stop = () => controller.abort();
  options.signal?.addEventListener("abort", stop);
  if (options.signal === undefined) process.once("SIGINT", stop);
  const sleep = options.sleep ?? wait;
  let after = cursor;
  let failing = false;
  try {
    while (!controller.signal.aborted) {
      await sleep(FOLLOW_MS, controller.signal);
      if (controller.signal.aborted) break;
      const next = await ask(after);
      if (next.status === "error") {
        // Signed out stays signed out: say so and stop. Anything else is
        // said once and retried, as a tail should.
        if (
          next.reason === "unauthenticated" ||
          next.reason === "forbidden" ||
          next.reason === "not-found"
        ) {
          console.error(
            pc.red("val logs: ") +
              describeValBuildFailure(
                target,
                next.reason,
                next.message,
                "logs",
              ),
          );
          process.exitCode = 1;
          return;
        }
        if (!failing && !options.json) {
          print(
            pc.yellow(
              `Val Build could not be asked just now (${next.message}). Still trying…`,
            ),
          );
        }
        failing = true;
        continue;
      }
      failing = false;
      if (next.answer.status !== "ok") continue;
      after = next.answer.cursor;
      // By time: a request that arrives late goes where it happened.
      show(
        [...next.answer.requests].sort(
          (a, b) => Date.parse(b.time) - Date.parse(a.time),
        ),
      );
    }
  } finally {
    options.signal?.removeEventListener("abort", stop);
    process.removeListener("SIGINT", stop);
  }
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

type Parsed =
  | {
      status: "ok";
      since: Date;
      label: string;
      levels: SiteLogRequestLevel[];
    }
  | { status: "error"; message: string };

export function parseOptions(options: LogsOptions, now: number): Parsed {
  if (
    options.limit !== undefined &&
    (!Number.isInteger(options.limit) ||
      options.limit < 1 ||
      options.limit > 1000)
  ) {
    return {
      status: "error",
      message: "--limit takes a whole number from 1 to 1000.",
    };
  }
  const levels: SiteLogRequestLevel[] = [];
  for (const part of (options.level ?? "").split(",")) {
    const name = part.trim().toLowerCase();
    if (name === "") continue;
    const level = LEVELS.find((known) => known === name);
    if (level === undefined) {
      return {
        status: "error",
        message: `--level takes error, warn or info, or several with commas (got "${part.trim()}").`,
      };
    }
    levels.push(level);
  }
  const since = sinceOf(options.since ?? "15m", now);
  if (since === null) {
    return {
      status: "error",
      message: `--since takes a duration like 30s, 15m or 1h, or an ISO time (got "${options.since}").`,
    };
  }
  if (since.at < now - RETENTION_MS) {
    return {
      status: "error",
      message:
        "Val Build keeps the last hour of requests. For older errors, grouped, see:\n\n    npx val errors",
    };
  }
  return {
    status: "ok",
    since: new Date(since.at),
    label: since.label,
    levels: levels.length === 0 ? [...LEVELS] : levels,
  };
}

function sinceOf(
  raw: string,
  now: number,
): { at: number; label: string } | null {
  const duration = /^(\d+)\s*(s|m|h)$/.exec(raw.trim());
  if (duration !== null) {
    const amount = Number(duration[1]);
    const unit = duration[2];
    const ms =
      amount * (unit === "s" ? 1_000 : unit === "m" ? 60_000 : 3_600_000);
    const word = unit === "s" ? "second" : unit === "m" ? "minute" : "hour";
    return {
      at: now - ms,
      label: `the last ${amount === 1 ? word : `${amount} ${word}s`}`,
    };
  }
  const at = Date.parse(raw);
  if (Number.isNaN(at)) return null;
  return { at, label: `the time since ${new Date(at).toLocaleTimeString()}` };
}

function headerOf(
  target: ValBuildTarget,
  answer: Extract<SiteLogsAnswer, { status: "ok" }>,
  label: string,
  options: LogsOptions,
): string {
  const count = answer.requests.length;
  const parts = [
    `${target.project}: ${count}${answer.truncated ? "+" : ""} ${count === 1 ? "request" : "requests"} in ${label}, oldest first`,
  ];
  if (options.search) parts.push(`matching "${options.search}"`);
  if (options.follow) parts.push("following");
  return (
    parts.join(", ") +
    (options.follow
      ? "\nCtrl-C to stop. New requests can take up to a minute to start arriving."
      : "")
  );
}

/** One request: a line for it, and one indented under it per line it printed. */
export function formatRequest(
  request: SiteLogRequest,
  verbose: boolean,
): string {
  const level = siteLogRequestLevel(request);
  const paint =
    level === "error" ? pc.red : level === "warn" ? pc.yellow : pc.white;
  const status =
    request.status !== null
      ? String(request.status)
      : outcomeLabel(request.outcome);
  const head = [
    pc.dim(clock(request.time)),
    paint(status.padEnd(4)),
    `${request.method ?? ""} ${request.path ?? ""}`.trim(),
    pc.dim(duration(request.durationMs)),
    ...(request.proposal !== null
      ? [pc.dim(`proposal ${request.proposal}`)]
      : []),
  ].join("  ");
  const lines = [head];
  for (const line of request.lines) {
    lines.push(formatLine(request, line, verbose));
  }
  return lines.join("\n");
}

function formatLine(
  request: SiteLogRequest,
  line: SiteLogLine,
  verbose: boolean,
): string {
  const offset = Math.max(0, Date.parse(line.time) - Date.parse(request.time));
  const paint =
    line.level === "error"
      ? pc.red
      : line.level === "warn"
        ? pc.yellow
        : line.level === "debug"
          ? pc.dim
          : (text: string) => text;
  const out = [
    `    ${pc.dim(`+${duration(offset)}`.padEnd(9))} ${paint(line.level.padEnd(5))} ${line.message}`,
  ];
  if (verbose && line.stack !== null) {
    for (const frame of line.stack.split("\n")) {
      if (frame.trim() !== "") out.push(pc.dim(`        ${frame.trim()}`));
    }
  }
  return out.join("\n");
}

function outcomeLabel(outcome: SiteLogRequest["outcome"]): string {
  switch (outcome) {
    case "ok":
      return "—";
    case "exception":
      return "threw";
    case "cpu":
      return "stopped: CPU limit";
    case "memory":
      return "stopped: memory limit";
    case "canceled":
      return "canceled";
  }
}

function clock(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

function duration(ms: number | null): string {
  if (ms === null) return "";
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}
