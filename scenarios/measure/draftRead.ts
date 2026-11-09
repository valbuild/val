/**
 * What a draft read costs on Val's server today, in time and in heap.
 *
 * Phase 0 of `docs/plans/one-content-model.md`: the numbers the head's design
 * and its 128 MB budget are argued from. It measures the PRODUCT's request, not
 * a model of it: TanStack's real `initValServer` route handler in memory mode,
 * asked what a draft-mode `fetchVal` asked until phase 6 (`PUT /sources/~`:
 * the whole tree, patches applied, validated, previewed), and -- `reader` --
 * what a draft-mode `fetchVal` reads since: the runtime's head, through
 * `serverDraftSource`, for every module of the project (a page that reads
 * them all), the first read after the chain moved and the ones after it.
 *
 * Not a test: it prints. Run from `scenarios/`:
 *
 *   pnpm exec tsx measure/draftRead.ts all              # everything, about an hour
 *   pnpm exec tsx measure/draftRead.ts all --time-only  # times only, minutes
 *   pnpm exec tsx measure/draftRead.ts run synth:5 draft
 *
 * Heap: each (input, operation) is run in a child Node process with
 * `--max-old-space-size` set, and the smallest limit it completes in is found
 * by bisection, to within 8 MB. That is the V8 OLD-generation limit, so the young generation
 * and code come on top; a Cloudflare isolate's 128 MB covers all of it, and
 * the app's own bundle as well. So read the result as "at least this much".
 */
import { spawnSync } from "child_process";
import path from "path";
import { performance } from "perf_hooks";
import v8 from "v8";
import type { ValModules } from "@valbuild/core";
import { createValClient, type ValClient } from "@valbuild/shared/internal";
import { InMemoryPatchStore, initValServer } from "@valbuild/tanstack/server";
import { loadValModules } from "@valbuild/server";
import { createValRuntime, type ValRuntime } from "@valbuild/server/internal";
import {
  DESCRIBE,
  MB,
  OPERATIONS,
  contentBytes,
  runOperation,
  readEveryModule,
  seedChain,
  syntheticConfig as config,
  syntheticInput,
  parseSyntheticInput,
  type LoadedInput,
  type Operation,
} from "./draftReadWork";

const INPUTS = [
  "web",
  "synth:1",
  "synth:5",
  "synth:10",
  "synth:20",
  "synth:1+650",
] as const;
type Input = (typeof INPUTS)[number];

/**
 * `draftReadWork.ts`'s operations, and `reader`, which reads in-process and
 * so is Node's alone (the isolate probe asks over HTTP).
 */
type NodeOperation = Operation | "reader";
const NODE_OPERATIONS: NodeOperation[] = [...OPERATIONS, "reader"];
const NODE_DESCRIBE: Record<NodeOperation, string> = {
  ...DESCRIBE,
  reader:
    "every module through serverDraftSource, as a draft-mode fetchVal reads since phase 6: the head",
};

// ---------------------------------------------------------------------------
// Inputs: the synthetic ones are in `draftReadWork.ts`, shared with the
// Cloudflare isolate probe.

async function loadInput(input: Input): Promise<LoadedInput> {
  if (input === "web") {
    // valbuild/web, a real production site, evaluated the way `val validate`
    // does it (node:vm). Its own config is in the registry.
    const valModules = loadValModules(path.resolve("/home/user/web"));
    const bytes = await contentBytes(valModules);
    return { valModules, bytes, patches: 0, target: null };
  }
  const parsed = parseSyntheticInput(input);
  if (parsed === null) throw new Error(`unknown input: ${input}`);
  return syntheticInput(parsed.megabytes, parsed.patches);
}

// ---------------------------------------------------------------------------
// One run

async function serverFor(
  valModules: ValModules,
): Promise<{ client: ValClient; runtime: Promise<ValRuntime> }> {
  const patchStore = new InMemoryPatchStore();
  // The readers' runtime: the one `initValServer` builds its server on, for
  // the same modules and options.
  const runtime = createValRuntime(
    valModules,
    "/api/val",
    {
      ...config,
      sourceFiles: {},
      patchStore,
      unsafelyAllowUnauthenticated: true,
    },
    config,
  );
  const { valApiHandler } = initValServer(valModules, config, {
    sourceFiles: {},
    patchStore,
    unsafelyAllowUnauthenticated: true,
    draftMode: {
      isEnabled: async () => true,
      enable: async () => {},
      disable: async () => {},
    },
  });
  const client = createValClient("/api/val", null, {
    fetch: (input, init) =>
      valApiHandler(new Request(new URL(input, "http://localhost").href, init)),
  });
  return { client, runtime };
}

function heapMB(): number {
  globalThis.gc?.();
  return v8.getHeapStatistics().used_heap_size / MB;
}

/** One input and operation, in this process: times, and heap retained. */
async function measure(input: Input, op: NodeOperation, repeats: number) {
  const before = heapMB();
  const generated = await loadInput(input);
  const { valModules, bytes, patches } = generated;
  const { client, runtime } = await serverFor(valModules);
  await seedChain(client, generated);
  await runOperation(client, "load");
  const loaded = heapMB();
  const times: number[] = [];
  for (let i = 0; i < repeats; i++) {
    const start = performance.now();
    if (op === "reader") {
      // A request's own source, as each request makes one.
      await readEveryModule(runtime, valModules);
    } else {
      await runOperation(client, op);
    }
    times.push(performance.now() - start);
  }
  const after = heapMB();
  times.sort((a, b) => a - b);
  return {
    input,
    op,
    contentMB: bytes / MB,
    patches,
    firstMs: times.length > 0 ? Math.max(...times) : 0,
    medianMs: times.length > 0 ? times[Math.floor(times.length / 2)] : 0,
    heapLoadedMB: loaded - before,
    heapAfterMB: after - before,
  };
}

/** The smallest old-generation limit (MB) the run completes in. */
function minimumHeap(input: Input, op: NodeOperation): number | null {
  const passes = (limit: number) => {
    const child = spawnSync(
      process.execPath,
      [
        `--max-old-space-size=${limit}`,
        "--import",
        "tsx",
        __filename,
        "run",
        input,
        op,
        "1",
      ],
      { encoding: "utf8", cwd: process.cwd(), timeout: 600_000 },
    );
    return child.status === 0;
  };
  let low = 8;
  let high = 512;
  if (!passes(high)) return null;
  // To within 8 MB: the answer is a lower bound anyway (see the README).
  while (high - low > 8) {
    const mid = Math.floor((low + high) / 2);
    if (passes(mid)) high = mid;
    else low = mid;
  }
  return high;
}

// ---------------------------------------------------------------------------

async function main() {
  const [mode, inputArg, opArg, repeatsArg] = process.argv.slice(2);
  if (mode === "run") {
    const input = INPUTS.find((i) => i === inputArg);
    const op = NODE_OPERATIONS.find((o) => o === opArg);
    if (input === undefined || op === undefined) {
      throw new Error(`unknown input or operation: ${inputArg} ${opArg}`);
    }
    const result = await measure(input, op, Number(repeatsArg ?? 5));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (mode !== "all") {
    throw new Error(
      "usage: draftRead.ts all [--time-only] | run <input> <op> [repeats]",
    );
  }
  // Times without the heap bisection: minutes rather than an hour, for a
  // re-run on a quiet machine.
  const timeOnly = inputArg === "--time-only";
  const rows = [];
  for (const input of INPUTS) {
    for (const op of NODE_OPERATIONS) {
      if (op === "base" && input.includes("+")) continue;
      const timed = spawnSync(
        process.execPath,
        ["--expose-gc", "--import", "tsx", __filename, "run", input, op, "5"],
        { encoding: "utf8", cwd: process.cwd(), timeout: 600_000 },
      );
      if (timed.status !== 0) {
        process.stderr.write(timed.stderr);
        throw new Error(`${input} ${op} failed`);
      }
      const line = timed.stdout.trim().split("\n").at(-1) ?? "{}";
      const result = JSON.parse(line);
      const heap = timeOnly ? null : minimumHeap(input, op);
      rows.push({ ...result, minHeapMB: heap });
      process.stderr.write(`${input} ${op}: ${JSON.stringify(rows.at(-1))}\n`);
    }
  }
  process.stdout.write(
    `${JSON.stringify({ describe: NODE_DESCRIBE, rows })}\n`,
  );
}

void main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});
