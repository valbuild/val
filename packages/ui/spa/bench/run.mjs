/**
 * Runs the store benchmark in a real Chromium and prints the table.
 *
 *   node packages/ui/spa/bench/run.mjs [--reps 5] [--size realistic] [--json out.json]
 *
 * Sizes: screen (default, MEASURED against the real Studio), realistic, small,
 * large, page. See README.md —
 * the inflated mount counts in `large` and `page` are diagnostic instruments, and
 * quoting them as a session cost is how an early version of this benchmark
 * reported mounting as a loss.
 *
 * Why a real browser at all: every cost claim in `architecture.md` is an
 * invocation COUNT asserted in node. Counts were chosen because they are exactly
 * reproducible, but they cannot tell you whether the thing being counted takes 20
 * microseconds or 20 milliseconds, and they cannot see main-thread blocking,
 * which is what makes typing feel bad. This closes that gap.
 *
 * Chromium is driven over CDP using node's built-in fetch and WebSocket rather
 * than Playwright, which is not installed here. The bundle is built with the
 * esbuild binary out of the pnpm store.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../../..");
const ESBUILD = path.join(
  REPO,
  "node_modules/.pnpm/esbuild@0.27.2/node_modules/esbuild/bin/esbuild",
);
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1];
};
const reps = Number(flag("reps", "5"));
// `realistic` by default: it is the only shape that describes a session. The
// others are diagnostic — see bench/README.md.
const sizes = flag("size", "screen").split(",");
const jsonOut = flag("json", null);

function sh(cmd, cmdArgs, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, cmdArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      ...opts,
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) =>
      code === 0
        ? resolve(out)
        : reject(new Error(cmd + " exited " + code + "\n" + err)),
    );
  });
}

const PAGE =
  '<!doctype html><meta charset="utf-8"><title>val bench</title>' +
  '<script src="/bench.js"></script>';

// --- 1. bundle -------------------------------------------------------------
const work = mkdtempSync(path.join(tmpdir(), "val-bench-"));
const bundlePath = path.join(work, "bench.js");
process.stderr.write("bundling...\n");
await sh(
  ESBUILD,
  [
    path.join(HERE, "entry.ts"),
    "--bundle",
    "--format=iife",
    "--platform=browser",
    "--target=chrome120",
    // The React harness is .tsx. Automatic runtime, so no React import is
    // needed in a file that only renders.
    "--jsx=automatic",
    // Production-like: the shipped Studio is minified, and measuring unminified
    // code would flatter whichever system has more dead code to strip.
    "--minify",
    '--define:process.env.NODE_ENV="production"',
    "--outfile=" + bundlePath,
    "--log-level=error",
  ],
  { cwd: REPO },
);
const bundle = readFileSync(bundlePath, "utf8");
process.stderr.write(
  "bundle: " + (bundle.length / 1024).toFixed(0) + " KB minified\n",
);

/**
 * The worker realm, bundled separately.
 *
 * It cannot share the page bundle: that one is an IIFE which assigns
 * `window.valBench`, and a worker has no `window`. Two entry points is also the
 * shape a shipped Studio would have, so this is not a benchmark-only compromise.
 */
const workerBundlePath = path.join(work, "worker.js");
await sh(
  ESBUILD,
  [
    path.join(HERE, "workerRealmEntry.ts"),
    "--bundle",
    "--format=iife",
    "--platform=browser",
    "--target=chrome120",
    "--minify",
    '--define:process.env.NODE_ENV="production"',
    "--outfile=" + workerBundlePath,
    "--log-level=error",
  ],
  { cwd: REPO },
);
const workerBundle = readFileSync(workerBundlePath, "utf8");
process.stderr.write(
  "worker bundle: " + (workerBundle.length / 1024).toFixed(0) + " KB\n",
);

// --- 2. serve --------------------------------------------------------------
const server = createServer((req, res) => {
  if (req.url === "/bench.js") {
    res.writeHead(200, { "content-type": "text/javascript" });
    res.end(bundle);
    return;
  }
  // Same origin, so a classic `new Worker("/worker.js")` is allowed. A blob URL
  // would work too and would hide the fact that this is a separate script.
  if (req.url === "/worker.js") {
    res.writeHead(200, { "content-type": "text/javascript" });
    res.end(workerBundle);
    return;
  }
  res.writeHead(200, { "content-type": "text/html" });
  res.end(PAGE);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

// --- 3. launch chromium ----------------------------------------------------
const cdpPort = 9500 + (process.pid % 400);
process.stderr.write("launching chromium...\n");
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    // No throttling of background work: a benchmark that gets throttled is
    // measuring the throttler.
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--remote-debugging-port=" + cdpPort,
    "http://127.0.0.1:" + port + "/" + (process.env.BENCH_QUERY || ""),
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
let chromeErr = "";
chrome.stderr.on("data", (d) => (chromeErr += d.toString()));

async function findPage() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const list = await (
        await fetch("http://127.0.0.1:" + cdpPort + "/json/list")
      ).json();
      const found = list.find(
        (t) => t.type === "page" && t.webSocketDebuggerUrl,
      );
      if (found) return found;
    } catch {
      // chromium is not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    "Chromium never exposed a page over CDP.\n" + chromeErr.slice(0, 800),
  );
}

const target = await findPage();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = () => reject(new Error("CDP websocket failed"));
});

let nextId = 0;
const pending = new Map();
const pageErrors = [];
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.method === "Runtime.consoleAPICalled") {
    if (message.params.type === "error") {
      pageErrors.push(
        message.params.args.map((a) => a.value ?? a.description).join(" "),
      );
    }
    return;
  }
  if (message.id !== undefined && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(JSON.stringify(message.error)));
    else resolve(message.result);
  }
};
const send = (method, params) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

await send("Runtime.enable", {});

async function evaluate(expression) {
  const res = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (res.exceptionDetails) {
    const detail =
      res.exceptionDetails.exception?.description ??
      JSON.stringify(res.exceptionDetails);
    throw new Error("In-page error: " + detail);
  }
  return res.result.value;
}

// Wait for the bundle to define the entry point rather than for a load event: a
// load event can fire before the script's own top-level work has run.
for (let attempt = 0; ; attempt++) {
  const ready = await evaluate("typeof window.valBench === 'object'");
  if (ready) break;
  if (attempt > 40) {
    throw new Error(
      "window.valBench never appeared - the bundle failed to run.\n" +
        pageErrors.join("\n"),
    );
  }
  await new Promise((r) => setTimeout(r, 250));
}

process.stderr.write(
  "running " + reps + " reps x " + sizes.join(",") + "...\n",
);
const payload = await evaluate(
  "window.valBench.run(" + reps + ", " + JSON.stringify(sizes) + ")",
);

// --- 3b. retained heap ------------------------------------------------------
/**
 * How much does each system HOLD?
 *
 * Driven from out here rather than in the page because the reading worth having
 * is retained heap after a forced collection, and both the collection and the
 * measurement are CDP calls. `performance.memory` in-page reports a number the
 * GC has not been asked to settle, which for a comparison of two caches is
 * noise.
 *
 * The engine keeps ~30 hand-enumerated snapshot maps and deep-clones per module
 * read; the stores clone nothing on the read path. That should be visible, and
 * it is the one claim in `architecture.md` that neither the counts nor the
 * durations can speak to.
 */
async function heapAfterGc() {
  await send("HeapProfiler.collectGarbage", {});
  // Twice: one pass frees the objects, the second frees what the first made
  // unreachable. A single collect reliably over-reports by a few hundred KB.
  await send("HeapProfiler.collectGarbage", {});
  const usage = await send("Runtime.getHeapUsage", {});
  return usage.usedSize;
}

async function measureMemory(sizeNames) {
  const rows = [];
  for (const size of sizeNames) {
    // A baseline taken with nothing held, in the same page, so the delta is the
    // system rather than the bundle and the runtime.
    await evaluate("window.valBench.releaseMemoryHold()");
    const baseline = await heapAfterGc();
    for (const driver of ["ValSyncEngine", "stores"]) {
      const built = await evaluate(
        "window.valBench.buildForMemory(" +
          JSON.stringify(driver) +
          ", " +
          JSON.stringify(size) +
          ")",
      );
      const held = await heapAfterGc();
      rows.push({
        size,
        driver,
        retainedBytes: held - baseline,
        fieldsReady: built.fieldsReady,
        modules: built.modules,
      });
      await evaluate("window.valBench.releaseMemoryHold()");
    }
  }
  return rows;
}

process.stderr.write("weighing retained heap...\n");
const memory = await measureMemory(sizes);

process.stderr.write("running with React mounted...\n");
const reactRows = await evaluate(
  "window.valBench.runReact(" +
    Math.min(reps, 5) +
    ", " +
    JSON.stringify(sizes) +
    ")",
);

// --- 3d. the worker seam ----------------------------------------------------
process.stderr.write("measuring the worker seam (real worker)...\n");
// The full `--reps`, not a cap: the seam's own ranges turned out to be the
// widest in this benchmark (an incremental reindex measured 17-57 ms), so this
// is the table that needs samples most.
const seam = await evaluate(
  "window.valBench.runWorkerSeam(" + reps + ", " + JSON.stringify(sizes) + ")",
);

ws.close();
chrome.kill("SIGKILL");
server.close();

// --- 4. report -------------------------------------------------------------
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const fmt = (n) =>
  n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2);
/**
 * Median with the spread beside it.
 *
 * A bare ratio of two medians is exactly how a benchmark overstates itself: at
 * these magnitudes the min-to-max range is often wider than the difference
 * between the two systems, and a reader cannot tell without seeing it.
 */
const spread = (values) => {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return fmt(lo) + "-" + fmt(hi);
};

const byCell = new Map();
for (const row of payload.results) {
  byCell.set(row.size + " " + row.scenario + " " + row.driver, row);
}
const scenarioNames = [...new Set(payload.results.map((r) => r.scenario))];

console.log("");
console.log(
  "Chromium " + payload.env.userAgent.replace(/^.*Chrome\//, "").split(" ")[0],
);
console.log(
  "cores: " +
    (payload.env.cores ?? "?") +
    " | reps: " +
    reps +
    " (median, first discarded)",
);

for (const size of sizes) {
  if (!payload.results.some((r) => r.size === size)) continue;
  console.log("");
  console.log("== " + size + " " + "=".repeat(Math.max(0, 70 - size.length)));
  console.log(
    "scenario".padEnd(14) +
      "engine ms".padStart(10) +
      "(range)".padStart(14) +
      "stores ms".padStart(10) +
      "(range)".padStart(14) +
      "ratio".padStart(7) +
      "  " +
      "eng sel".padStart(8) +
      "sto sel".padStart(8) +
      "  fields",
  );
  for (const scenario of scenarioNames) {
    const engine = byCell.get(size + " " + scenario + " ValSyncEngine");
    const stores = byCell.get(size + " " + scenario + " stores");
    if (!engine || !stores) continue;
    const em = median(engine.samples.map((s) => s.ms));
    const sm = median(stores.samples.map((s) => s.ms));
    const eSel = median(engine.samples.map((s) => s.selectCalls));
    const sSel = median(stores.samples.map((s) => s.selectCalls));
    const eFields = engine.samples[0]?.fieldsReady ?? 0;
    const sFields = stores.samples[0]?.fieldsReady ?? 0;
    const eMs = engine.samples.map((s) => s.ms);
    const sMs = stores.samples.map((s) => s.ms);
    // Overlapping ranges mean the medians are not separated by the measurement.
    // Marked rather than left for the reader to compute, because an unmarked
    // 1.4x on overlapping ranges is the single most misleading thing a
    // benchmark can print.
    const overlap =
      Math.min(...eMs) <= Math.max(...sMs) &&
      Math.min(...sMs) <= Math.max(...eMs);
    console.log(
      scenario.padEnd(14) +
        fmt(em).padStart(10) +
        ("[" + spread(eMs) + "]").padStart(14) +
        fmt(sm).padStart(10) +
        ("[" + spread(sMs) + "]").padStart(14) +
        (sm > 0 ? (em / sm).toFixed(1) + "x" : "-").padStart(7) +
        (overlap ? "?" : " ") +
        " " +
        String(eSel).padStart(8) +
        String(sSel).padStart(8) +
        "  " +
        eFields +
        (eFields === sFields ? "" : " vs " + sFields + "  NOT COMPARABLE"),
    );
  }
}

console.log("");
console.log(
  "? = the two ranges overlap, so the ratio is not established by this run.",
);
console.log("");
console.log("blocking - the part that runs inside the keydown handler:");
for (const size of sizes) {
  for (const scenario of ["keystroke", "keystroke-list", "burst-40"]) {
    const engine = byCell.get(size + " " + scenario + " ValSyncEngine");
    const stores = byCell.get(size + " " + scenario + " stores");
    if (!engine || !stores) continue;
    const eb = median(engine.samples.map((s) => s.blockingMs));
    const sb = median(stores.samples.map((s) => s.blockingMs));
    console.log(
      ("  " + size + "/" + scenario).padEnd(24) +
        ("engine " + fmt(eb) + "ms").padStart(18) +
        ("stores " + fmt(sb) + "ms").padStart(18),
    );
  }
}

console.log("");
console.log(
  "with React mounted - what reconciliation adds, and who re-renders:",
);
console.log(
  "  " +
    "size".padEnd(8) +
    "driver".padEnd(15) +
    "mount ms".padStart(9) +
    "renders".padStart(9) +
    "  |" +
    "keystroke ms".padStart(13) +
    "renders".padStart(9) +
    "   fields",
);
for (const size of sizes) {
  for (const driver of ["ValSyncEngine", "stores"]) {
    const row = reactRows.find((r) => r.size === size && r.driver === driver);
    if (!row || row.samples.length === 0) continue;
    const mountMs = median(row.samples.map((s) => s.mountMs));
    const keyMs = median(row.samples.map((s) => s.keystrokeMs));
    const mountRenders = median(row.samples.map((s) => s.mountRenders));
    const keyRenders = median(row.samples.map((s) => s.keystrokeRenders));
    const fields = row.samples[0].fields;
    console.log(
      "  " +
        size.padEnd(8) +
        driver.padEnd(15) +
        fmt(mountMs).padStart(9) +
        String(mountRenders).padStart(9) +
        "  |" +
        fmt(keyMs).padStart(13) +
        String(keyRenders).padStart(9) +
        "   " +
        fields,
    );
  }
}
console.log(
  "  `keystroke renders` is the number this table exists for: the engine's",
);
console.log(
  "  finest source subscription is per MODULE, so every mounted field in the",
);
console.log("  edited module re-renders. Per-path notification wakes one.");

console.log("");
console.log(
  "retained heap, after two forced collections (delta over baseline):",
);
console.log(
  "  " +
    "size".padEnd(8) +
    "engine".padStart(11) +
    "stores".padStart(11) +
    "ratio".padStart(8) +
    "   per field",
);
for (const size of sizes) {
  const engine = memory.find(
    (r) => r.size === size && r.driver === "ValSyncEngine",
  );
  const stores = memory.find((r) => r.size === size && r.driver === "stores");
  if (!engine || !stores) continue;
  const kb = (bytes) => (bytes / 1024).toFixed(0) + " KB";
  const perField = (row) =>
    row.fieldsReady > 0
      ? (row.retainedBytes / row.fieldsReady / 1024).toFixed(1) + " KB"
      : "-";
  console.log(
    "  " +
      size.padEnd(8) +
      kb(engine.retainedBytes).padStart(11) +
      kb(stores.retainedBytes).padStart(11) +
      (stores.retainedBytes > 0
        ? (engine.retainedBytes / stores.retainedBytes).toFixed(1) + "x"
        : "-"
      ).padStart(8) +
      "   " +
      perField(engine) +
      " vs " +
      perField(stores),
  );
}
console.log(
  "  A single reading each, not a median: a forced-GC heap delta is stable to",
);
console.log(
  "  a few percent but repeating it does not make it more meaningful.",
);

// --- the worker seam -------------------------------------------------------
/**
 * Two columns, and the decision is the pair.
 *
 * `total` is wall clock: a worker should always LOSE it, because it does the
 * same work plus two structured clones plus scheduling. `block` is the longest
 * uninterrupted main-thread task during the call, which is the only thing a
 * worker can improve and the only thing a keystroke feels.
 *
 * So a row is worth moving to a worker when its `block` drops a lot and its
 * `total` does not matter — a background pass. It is not worth moving when
 * `block` was already small, because then all the worker did was add latency.
 */
console.log("");
console.log("the worker seam: three stores in a REAL worker vs in-process");
console.log(
  "  " +
    "op".padEnd(15) +
    "payload".padStart(9) +
    "  |" +
    "in-proc total".padStart(14) +
    "delay".padStart(9) +
    "  |" +
    "worker total".padStart(13) +
    "delay".padStart(9) +
    "  |" +
    "  total".padStart(8) +
    "delay".padStart(8),
);
const seamByCell = new Map();
for (const row of seam.results) {
  seamByCell.set(row.size + " " + row.op + " " + row.realm, row);
}
const seamOps = [...new Set(seam.results.map((r) => r.op))];
for (const size of sizes) {
  if (!seam.results.some((r) => r.size === size)) continue;
  for (const op of seamOps) {
    const local = seamByCell.get(size + " " + op + " in-process");
    const worker = seamByCell.get(size + " " + op + " worker");
    if (!local || !worker) continue;
    const lt = median(local.samples.map((s) => s.totalMs));
    const wt = median(worker.samples.map((s) => s.totalMs));
    const lb = median(local.samples.map((s) => s.maxDelayMs));
    const wb = median(worker.samples.map((s) => s.maxDelayMs));
    const bytes = median(worker.samples.map((s) => s.payloadBytes));
    // Zero ticks means the main thread never yielded once during the region.
    // Marked, because "waited 121 ms" and "never got a turn at all" are the
    // same reading and not the same fact.
    const lYield = local.samples.every((s) => s.ticks === 0) ? "!" : " ";
    const wYield = worker.samples.every((s) => s.ticks === 0) ? "!" : " ";
    // The same rule the main table follows, and it earned its place here: an
    // incremental reindex measured 17-57 ms in-process against 28-36 in the
    // worker, whose medians say "the worker is 0.7x, i.e. FASTER" - which is
    // impossible, and is just the ranges overlapping.
    const overlaps = (a, b) =>
      Math.min(...a) <= Math.max(...b) && Math.min(...b) <= Math.max(...a);
    const lTotals = local.samples.map((s) => s.totalMs);
    const wTotals = worker.samples.map((s) => s.totalMs);
    const lDelays = local.samples.map((s) => s.maxDelayMs);
    const wDelays = worker.samples.map((s) => s.maxDelayMs);
    const totalMark = overlaps(lTotals, wTotals) ? "?" : " ";
    const delayMark = overlaps(lDelays, wDelays) ? "?" : " ";
    // `answered` is this table's `fieldsReady`: if the two realms disagree on
    // what the call returned, the row is not a comparison.
    const la = local.samples[0]?.answered ?? 0;
    const wa = worker.samples[0]?.answered ?? 0;
    const payload =
      bytes >= 1024 ? (bytes / 1024).toFixed(0) + " KB" : bytes + " B";
    console.log(
      "  " +
        op.padEnd(15) +
        payload.padStart(9) +
        "  |" +
        fmt(lt).padStart(14) +
        fmt(lb).padStart(8) +
        lYield +
        "  |" +
        fmt(wt).padStart(13) +
        fmt(wb).padStart(8) +
        wYield +
        "  |" +
        // Worker-relative, so >1 means the worker cost more. The other tables
        // read the other way round; labelled below rather than silently flipped.
        (lt > 0 ? (wt / lt).toFixed(1) + "x" : "-").padStart(7) +
        totalMark +
        (lb > 0 ? (wb / lb).toFixed(2) + "x" : "-").padStart(7) +
        delayMark +
        (la === wa
          ? ""
          : "   answered " + la + " vs " + wa + " NOT COMPARABLE"),
    );
  }
}
console.log(
  "  ratios are WORKER / IN-PROCESS, the opposite of the tables above: above",
);
console.log(
  "  1.0x means the worker cost more. total should always be >1 - a worker does",
);
console.log(
  "  the same work plus two clones. delay below 1.0x is the win. `delay` is how",
);
console.log(
  "  long a task queued behind the call waited; ! = the main thread never",
);
console.log(
  "  yielded at all during the region. ? = the two ranges overlap, so that ratio",
);
console.log("  is not established by this run.");
console.log(
  "  probe floor: " +
    fmt(seam.probeFloorMs) +
    " ms - a block reading at the floor means nothing",
);
console.log("  longer than the floor happened, not that nothing happened.");

console.log("");
for (const [name, note] of Object.entries(payload.notes)) {
  console.log("  " + name.padEnd(13) + " " + note);
}
console.log("");

if (jsonOut) {
  writeFileSync(
    jsonOut,
    JSON.stringify({ ...payload, memory, react: reactRows, seam }, null, 2),
  );
  console.log("raw samples -> " + jsonOut);
}

if (pageErrors.length > 0) {
  console.error("Page reported errors during the run:");
  for (const error of pageErrors.slice(0, 10)) console.error("  " + error);
}

const mismatch = payload.results.some((row) => {
  const other = payload.results.find(
    (o) =>
      o.size === row.size &&
      o.scenario === row.scenario &&
      o.driver !== row.driver,
  );
  return other && row.samples[0]?.fieldsReady !== other.samples[0]?.fieldsReady;
});
if (mismatch) {
  console.error(
    "A row reports a different fieldsReady per driver. That is not a comparison " +
      "- the two systems were not asked the same question. Fix the harness " +
      "before believing any number above.",
  );
  process.exit(1);
}
