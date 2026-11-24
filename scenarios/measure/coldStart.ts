/**
 * A site's first request in a fresh process: what a cold isolate on Val's
 * hosting pays before it can answer anything. Imports a built TanStack Start
 * server (`vite build`'s `dist/server/server.js`), sends it ONE request for a
 * public page (no cookies, so no draft mode), and prints the wall time of the
 * import, of the request, and every module the process loaded to answer it --
 * the bundle's own chunks and the packages it left external -- with their
 * sizes on disk.
 *
 * The question it answers is "what does serving published content evaluate?",
 * and the answer that matters is the module list, not the stopwatch: the
 * Studio (`@valbuild/ui`), TypeScript, prettier, sucrase and the MCP SDK
 * belong to the Val API and to drafts, never to a visitor's page.
 * `packages/tanstack/src/server/servingPath.test.ts` is what CI checks; this
 * prints.
 *
 * Each run is its own child process (rule 4 of README.md), so nothing an
 * earlier run loaded is in the module cache. The numbers are Node's on this
 * machine: an isolate compiles the same bytes, but its clock is not this one.
 *
 * Not a test: it prints. Run from `scenarios/`, after
 * `cd examples/tanstack && pnpm run build`:
 *
 *   pnpm exec tsx measure/coldStart.ts ../examples/tanstack/dist/server/server.js / 5
 */
import { spawnSync } from "child_process";
import path from "path";
import { pathToFileURL } from "url";

/**
 * What runs in the child: a synchronous module hook (`registerHooks`, so it is
 * in this thread and sees CommonJS too) records every file loaded, then the
 * server is imported and one request is sent. Plain JavaScript, run by `node`
 * itself: tsx in the child would be a loader of its own in the numbers.
 */
const CHILD = String.raw`
import { registerHooks } from "node:module";
import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
const loaded = new Map();
const parentOf = new Map();
registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolved = nextResolve(specifier, context);
    if (!parentOf.has(resolved.url) && context.parentURL) {
      parentOf.set(resolved.url, context.parentURL);
    }
    return resolved;
  },
  load(url, context, nextLoad) {
    if (url.startsWith("file:") && !loaded.has(url)) {
      let bytes = 0;
      try { bytes = statSync(fileURLToPath(url)).size; } catch {}
      loaded.set(url, bytes);
    }
    return nextLoad(url, context);
  },
});
const [serverPath, pagePath] = process.argv.slice(-2);
const t0 = performance.now();
const mod = await import(serverPath);
const t1 = performance.now();
const res = await mod.default.fetch(new Request("http://localhost" + pagePath));
const body = await res.text();
const t2 = performance.now();
// Heap used right after the first request (what was allocated to answer it,
// garbage included), then after a full collection (what the process keeps).
const heapMB = process.memoryUsage().heapUsed / 1e6;
globalThis.gc();
const heapAfterGcMB = process.memoryUsage().heapUsed / 1e6;
process.stdout.write(JSON.stringify({
  status: res.status,
  heapAfterGcMB,
  bodyBytes: body.length,
  importMs: t1 - t0,
  requestMs: t2 - t1,
  heapMB,
  rssMB: process.memoryUsage().rss / 1e6,
  loaded: [...loaded].map(([url, bytes]) => ({
    url,
    bytes,
    parent: parentOf.get(url) ?? null,
  })),
}));
`;

type Run = {
  status: number;
  bodyBytes: number;
  importMs: number;
  requestMs: number;
  heapMB: number;
  heapAfterGcMB: number;
  rssMB: number;
  loaded: { url: string; bytes: number; parent: string | null }[];
};

/** The packages a public page must not evaluate. */
const HEAVY = [
  "@valbuild/ui/server",
  "typescript",
  "prettier",
  "sucrase",
  "@modelcontextprotocol",
];

/** A loaded file's package, as it is named in `node_modules`, or its chunk. */
function ownerOf(url: string, serverDir: string): string {
  const file = url.startsWith("file:") ? new URL(url).pathname : url;
  const nm = file.lastIndexOf("/node_modules/");
  if (nm >= 0) {
    const rest = file.slice(nm + "/node_modules/".length).split("/");
    return rest[0].startsWith("@") ? `${rest[0]}/${rest[1]}` : rest[0];
  }
  if (file.startsWith(serverDir)) {
    return `(bundle) ${path.relative(serverDir, file)}`;
  }
  // A workspace package, linked rather than installed: in this repository an
  // external `@valbuild/*` resolves to `packages/<name>/.../dist`.
  const workspace = /\/packages\/([^/]+)\/(server\/)?/.exec(file);
  if (workspace !== null) {
    // The Studio's server entry, with its embedded assets, apart from the
    // package's small root (constants a page's provider reads).
    return workspace[1] === "ui" && workspace[2] !== undefined
      ? "@valbuild/ui/server"
      : `@valbuild/${workspace[1]}`;
  }
  return file;
}

function runOnce(serverPath: string, pagePath: string): Run {
  const res = spawnSync(
    process.execPath,
    [
      "--expose-gc",
      "--input-type=module",
      "-e",
      CHILD,
      pathToFileURL(serverPath).href,
      pagePath,
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: process.env },
  );
  if (res.status !== 0) {
    throw new Error(`child failed (${res.status}):\n${res.stderr}`);
  }
  const out = res.stdout.slice(res.stdout.indexOf('{"status"'));
  return JSON.parse(out);
}

function main() {
  const serverPath = path.resolve(
    process.argv[2] ?? "../examples/tanstack/dist/server/server.js",
  );
  const pagePath = process.argv[3] ?? "/";
  const runs = Number(process.argv[4] ?? "3");
  const serverDir = path.dirname(serverPath);
  const results: Run[] = [];
  for (let i = 0; i < runs; i++) {
    results.push(runOnce(serverPath, pagePath));
  }
  const median = (xs: number[]) =>
    [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const first = results[0];
  const byOwner = new Map<string, { files: number; bytes: number }>();
  for (const { url, bytes } of first.loaded) {
    const owner = ownerOf(url, serverDir);
    const entry = byOwner.get(owner) ?? { files: 0, bytes: 0 };
    entry.files++;
    entry.bytes += bytes;
    byOwner.set(owner, entry);
  }
  const total = first.loaded.reduce((sum, { bytes }) => sum + bytes, 0);
  console.log(`${serverPath} GET ${pagePath} -> ${first.status}`);
  console.log(
    `runs: ${runs}; median import ${median(results.map((r) => r.importMs)).toFixed(0)} ms, ` +
      `median first request ${median(results.map((r) => r.requestMs)).toFixed(0)} ms, ` +
      `median heap used after it ${median(results.map((r) => r.heapMB)).toFixed(1)} MB ` +
      `(${median(results.map((r) => r.heapAfterGcMB)).toFixed(1)} MB after a full GC), ` +
      `median rss ${median(results.map((r) => r.rssMB)).toFixed(1)} MB`,
  );
  // A lower bound for an isolate, which also counts WebAssembly and the
  // app's own code: see README.md, "Heap, and the 128 MB isolate".
  console.log(
    `modules loaded: ${first.loaded.length} files, ${(total / 1e6).toFixed(2)} MB`,
  );
  const isHeavy = (owner: string) =>
    HEAVY.some((h) => owner === h || owner.startsWith(`${h}/`));
  const rows = [...byOwner].sort((a, b) => b[1].bytes - a[1].bytes);
  const heavy = rows.filter(([owner]) => isHeavy(owner));
  console.log(
    `heavy packages loaded: ${
      heavy.length === 0
        ? "none"
        : heavy
            .map(
              ([owner, { bytes }]) =>
                `${owner} (${(bytes / 1e6).toFixed(1)} MB)`,
            )
            .join(", ")
    }`,
  );
  // How each heavy package was reached: the chain of first importers, from
  // the server entry to the package's largest file.
  const parents = new Map(first.loaded.map((l) => [l.url, l.parent]));
  for (const [owner] of heavy) {
    const firstFile = first.loaded
      .filter((l) => ownerOf(l.url, serverDir) === owner)
      .sort((a, b) => b.bytes - a.bytes)[0];
    if (firstFile === undefined) continue;
    const chain: string[] = [];
    let url: string | null | undefined = firstFile.url;
    while (url) {
      const name = ownerOf(url, serverDir);
      const short = name.startsWith("(bundle)")
        ? name
        : `${name} (${path.basename(new URL(url).pathname)})`;
      if (chain[0] !== short) chain.unshift(short);
      url = parents.get(url);
    }
    console.log(`  ${owner}: ${chain.join(" -> ")}`);
  }
  for (const [owner, { files, bytes }] of rows) {
    const flag = isHeavy(owner) ? "  <-- heavy" : "";
    console.log(
      `  ${(bytes / 1e3).toFixed(0).padStart(8)} kB ${String(files).padStart(4)} files  ${owner}${flag}`,
    );
  }
}

main();
