/**
 * Drives the Cloudflare isolate probe (`isolate/`), and reads what it and
 * `wrangler tail` recorded.
 *
 * The probe cannot measure its own memory (a Worker has no heap statistics),
 * so this steps a draft read up through input sizes until Cloudflare kills
 * the isolate, which `wrangler tail` reports as the outcome `exceededMemory`.
 * A run against `wrangler dev` (local workerd) is a check that the probe
 * works and nothing more: local workerd is not known to enforce 128 MB. See
 * "The deployed isolate probe" in README.md.
 *
 * Not a test: it prints. Run from `scenarios/`:
 *
 *   pnpm exec tsx measure/isolateProbe.ts run --url <probe URL> --out <runs.jsonl>
 *   pnpm exec tsx measure/isolateProbe.ts summarize --runs <runs.jsonl> [--tail <tail.json>]
 *   pnpm exec tsx measure/isolateProbe.ts bundle --metafile <bundle-meta.json>
 */
import fs from "fs";
import nodePath from "path";
import { performance } from "perf_hooks";
import {
  PROBE_OPERATIONS,
  type ProbeFailure,
  type ProbeOperation,
  type ProbeRun,
} from "./isolate/probe";

/** Content sizes, in MB, stepped through in order. */
const DEFAULT_LADDER = [1, 2, 5, 10, 15, 20, 30, 40, 60, 80];
/** Failures in a row, at increasing sizes, before an operation stops climbing. */
const STOP_AFTER = 2;

type Args = Record<string, string | true>;

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      args[arg.slice(2)] = true;
    } else {
      args[arg.slice(2)] = next;
      i++;
    }
  }
  return args;
}

function str(args: Args, name: string): string | undefined {
  const value = args[name];
  return typeof value === "string" ? value : undefined;
}

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

// ---------------------------------------------------------------------------
// run

/** One request the driver sent, as written to `--out`. */
type RunRecord = {
  id: string;
  input: string;
  op: ProbeOperation;
  attempt: number;
  url: string;
  status: number;
  clientMs: number;
  at: string;
  body: ProbeRun | ProbeFailure | { text: string };
};

async function run(args: Args): Promise<void> {
  const base = str(args, "url") ?? "http://127.0.0.1:8787";
  const inputs = (str(args, "inputs") ?? "")
    .split(",")
    .filter((input) => input !== "");
  const ladder =
    inputs.length > 0
      ? inputs
      : [...DEFAULT_LADDER.map((mb) => `synth:${mb}`), "synth:1+650"];
  const ops = (str(args, "ops") ?? PROBE_OPERATIONS.join(","))
    .split(",")
    .map((name) => {
      const op = PROBE_OPERATIONS.find((o) => o === name);
      if (op === undefined) throw new Error(`unknown op: ${name}`);
      return op;
    });
  const repeats = Number(str(args, "repeats") ?? 1);
  const ballast = Number(str(args, "ballast") ?? 0);
  // Fresh by default: each request builds its input after dropping the last,
  // so a step measures one input, not the garbage of the steps before it.
  const warm = args.warm === true;
  const label = str(args, "label") ?? new Date().toISOString().slice(0, 19);
  const outPath = str(args, "out");
  const records: RunRecord[] = [];
  const failuresInARow = new Map<ProbeOperation, number>();
  let n = 0;

  out(`probe ${base}, label ${label}, ballast ${ballast} MB`);
  for (const input of ladder) {
    for (const op of ops) {
      if ((failuresInARow.get(op) ?? 0) >= STOP_AFTER) continue;
      let passed = false;
      // A failure is retried once: the kill can leave the next request a
      // cold isolate, which is the cleaner measurement of the two.
      for (let attempt = 1; attempt <= 2 && !passed; attempt++) {
        const id = `${label}-${++n}`;
        const query = new URLSearchParams({
          input,
          op,
          repeats: String(repeats),
          ballast: String(ballast),
          fresh: warm ? "0" : "1",
          id,
        });
        const url = `${base.replace(/\/$/, "")}/run?${query}`;
        const record = await request(url, { id, input, op, attempt });
        records.push(record);
        if (outPath) fs.appendFileSync(outPath, `${JSON.stringify(record)}\n`);
        passed = record.status === 200 && "ok" in record.body;
        out(describeRecord(record));
      }
      failuresInARow.set(op, passed ? 0 : (failuresInARow.get(op) ?? 0) + 1);
    }
    if (ops.every((op) => (failuresInARow.get(op) ?? 0) >= STOP_AFTER)) break;
  }
  out("");
  out(summaryTable(records, new Map()));
}

async function request(
  url: string,
  meta: { id: string; input: string; op: ProbeOperation; attempt: number },
): Promise<RunRecord> {
  const start = performance.now();
  let status = 0;
  let body: RunRecord["body"];
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(600_000) });
    status = res.status;
    const text = await res.text();
    body = parseBody(text);
  } catch (error) {
    body = { text: error instanceof Error ? error.message : String(error) };
  }
  return {
    ...meta,
    url,
    status,
    clientMs: Math.round(performance.now() - start),
    at: new Date().toISOString(),
    body,
  };
}

function parseBody(text: string): RunRecord["body"] {
  try {
    const json: unknown = JSON.parse(text);
    if (isProbeBody(json)) return json;
  } catch {
    // Cloudflare's own error page (1102 when the isolate exceeded memory).
  }
  return { text: text.slice(0, 300) };
}

function isProbeBody(json: unknown): json is ProbeRun | ProbeFailure {
  return (
    typeof json === "object" &&
    json !== null &&
    "ok" in json &&
    "isolate" in json
  );
}

function describeRecord(record: RunRecord): string {
  const body = record.body;
  const what = `${record.input} ${record.op}${record.attempt > 1 ? " (retry)" : ""}`;
  if ("text" in body) {
    return `${what}: HTTP ${record.status} in ${record.clientMs} ms: ${body.text.replace(/\s+/g, " ").slice(0, 120)}`;
  }
  if (!body.ok) {
    return `${what}: HTTP ${record.status}, failed at ${body.stage}: ${body.error}`;
  }
  return `${what}: ${mb(body.contentBytes)} MB${body.entries ? ` + ${body.entries} entries` : ""}, head ${mb(body.head.bytes)} MB, op ${body.ms.op.map(Math.round).join("/")} ms, build ${Math.round(body.ms.build)} ms, start ${Math.round(body.ms.start)} ms, isolate ${body.isolate.id.slice(0, 8)} #${body.isolate.requests}, client ${record.clientMs} ms`;
}

function mb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

// ---------------------------------------------------------------------------
// summarize: the runs, joined with `wrangler tail --format json`

/** The fields of a tail event this reads. Everything else is ignored. */
type TailEvent = {
  outcome: string;
  cpuTime?: number;
  wallTime?: number;
  url: string;
};

function readTail(path: string): Map<string, TailEvent> {
  const byId = new Map<string, TailEvent>();
  for (const value of jsonValues(fs.readFileSync(path, "utf8"))) {
    const event = tailEventOf(value);
    if (event === null) continue;
    const id = new URL(event.url).searchParams.get("id");
    if (id !== null) byId.set(id, event);
  }
  return byId;
}

function tailEventOf(value: unknown): TailEvent | null {
  if (typeof value !== "object" || value === null) return null;
  if (!("outcome" in value) || typeof value.outcome !== "string") return null;
  if (!("event" in value)) return null;
  const event = value.event;
  if (typeof event !== "object" || event === null) return null;
  if (!("request" in event)) return null;
  const req = event.request;
  if (typeof req !== "object" || req === null) return null;
  if (!("url" in req) || typeof req.url !== "string") return null;
  return {
    outcome: value.outcome,
    url: req.url,
    cpuTime:
      "cpuTime" in value && typeof value.cpuTime === "number"
        ? value.cpuTime
        : undefined,
    wallTime:
      "wallTime" in value && typeof value.wallTime === "number"
        ? value.wallTime
        : undefined,
  };
}

/**
 * Every JSON value in `text`, one after another: `wrangler tail --format
 * json` prints each event as an indented object, not one per line.
 */
function jsonValues(text: string): unknown[] {
  const values: unknown[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          values.push(JSON.parse(text.slice(start, i + 1)));
        } catch {
          // Not JSON after all: wrangler's banner, or a cut-off event.
        }
        start = -1;
      }
    }
  }
  return values;
}

function summaryTable(
  records: RunRecord[],
  tail: Map<string, TailEvent>,
): string {
  const rows = [
    "| Input | Op | Content | Head | HTTP | Outcome (tail) | CPU (tail) | Wall (tail) | Op (isolate clock) | Isolate | Client |",
    "| ----- | -- | ------- | ---- | ---- | -------------- | ---------- | ----------- | ------------------ | ------- | ------ |",
  ];
  for (const record of records) {
    const body = record.body;
    const event = tail.get(record.id);
    const ok = "ok" in body && body.ok;
    const content = ok ? `${mb(body.contentBytes)} MB` : "";
    // Runs recorded before the probe reported its head have none.
    const head = ok && body.head ? `${mb(body.head.bytes)} MB` : "";
    const opMs = ok ? body.ms.op.map(Math.round).join("/") + " ms" : "";
    const isolate =
      "isolate" in body
        ? `${body.isolate.id.slice(0, 8)} #${body.isolate.requests}`
        : "";
    const failure =
      "text" in body
        ? body.text.replace(/\s+/g, " ").slice(0, 40)
        : body.ok
          ? ""
          : `${body.stage}: ${body.error}`.slice(0, 60);
    rows.push(
      `| ${record.input} | ${record.op}${record.attempt > 1 ? " (retry)" : ""} | ${content} | ${head} | ${record.status}${failure ? ` ${failure}` : ""} | ${event?.outcome ?? "(no tail)"} | ${event?.cpuTime !== undefined ? `${event.cpuTime} ms` : ""} | ${event?.wallTime !== undefined ? `${event.wallTime} ms` : ""} | ${opMs} | ${isolate} | ${record.clientMs} ms |`,
    );
  }
  return rows.join("\n");
}

function summarize(args: Args): void {
  const runsPath = str(args, "runs");
  if (runsPath === undefined) throw new Error("summarize needs --runs");
  const records = fs
    .readFileSync(runsPath, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line): RunRecord => JSON.parse(line));
  const tailPath = str(args, "tail");
  const tail = tailPath ? readTail(tailPath) : new Map<string, TailEvent>();
  out(summaryTable(records, tail));
  if (tailPath) {
    const killed = [...tail.values()].filter(
      (event) => event.outcome === "exceededMemory",
    ).length;
    out("");
    out(
      `${tail.size} tail events matched, ${killed} exceededMemory. Outcomes: ${[
        ...new Set([...tail.values()].map((event) => event.outcome)),
      ].join(", ")}`,
    );
  }
}

// ---------------------------------------------------------------------------
// bundle: what the Worker's code is made of (`wrangler deploy --dry-run
// --outdir <dir> --metafile`), because the code counts toward 128 MB too

type Metafile = {
  outputs: Record<
    string,
    { bytes: number; inputs: Record<string, { bytesInOutput: number }> }
  >;
};

function bundle(args: Args): void {
  const path = str(args, "metafile");
  if (path === undefined) throw new Error("bundle needs --metafile");
  const meta: Metafile = JSON.parse(fs.readFileSync(path, "utf8"));
  for (const [file, output] of Object.entries(meta.outputs)) {
    if (file.endsWith(".map")) continue;
    const byPackage = new Map<string, number>();
    for (const [input, { bytesInOutput }] of Object.entries(output.inputs)) {
      const key = packageOf(input);
      byPackage.set(key, (byPackage.get(key) ?? 0) + bytesInOutput);
    }
    out(`${nodePath.basename(file)}: ${kib(output.bytes)} KiB`);
    out("");
    out("| Package | KiB | Share |");
    out("| ------- | --- | ----- |");
    for (const [key, bytes] of [...byPackage].sort((a, b) => b[1] - a[1])) {
      if (bytes < 1024) continue;
      out(
        `| ${key} | ${kib(bytes)} | ${((bytes / output.bytes) * 100).toFixed(1)}% |`,
      );
    }
  }
}

function packageOf(input: string): string {
  const inNodeModules =
    /node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)/.exec(
      input,
    );
  if (inNodeModules) return inNodeModules[1];
  const inRepo = /packages\/([^/]+)/.exec(input);
  if (inRepo) return `@valbuild/${inRepo[1]} (this repository)`;
  return input.includes("/web/") ? "valbuild/web" : "the probe";
}

function kib(bytes: number): string {
  return Math.round(bytes / 1024).toLocaleString("en");
}

// ---------------------------------------------------------------------------

async function main() {
  const [mode, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  if (mode === "run") return run(args);
  if (mode === "summarize") return summarize(args);
  if (mode === "bundle") return bundle(args);
  throw new Error(
    "usage: isolateProbe.ts run --url <url> [--out runs.jsonl] [--inputs synth:1,synth:5,web] [--ops draft,base] [--repeats N] [--ballast MB] [--warm] [--label L]\n" +
      "       isolateProbe.ts summarize --runs runs.jsonl [--tail tail.json]\n" +
      "       isolateProbe.ts bundle --metafile bundle-meta.json",
  );
}

void main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});
