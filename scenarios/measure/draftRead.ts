/**
 * What a draft read costs on Val's server today, in time and in heap.
 *
 * Phase 0 of `docs/plans/one-content-model.md`: the numbers the head's design
 * and its 128 MB budget are argued from. It measures the PRODUCT's request, not
 * a model of it: TanStack's real `initValServer` route handler in memory mode,
 * asked what a draft-mode `fetchVal` asks (`loadDraftSources`: the whole tree,
 * patches applied, validated, previewed).
 *
 * Not a test: it prints. Run from `scenarios/`:
 *
 *   pnpm exec tsx measure/draftRead.ts all            # everything, a few minutes
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
import {
  Internal,
  initVal,
  modules as defineModules,
  type ModuleFilePath,
  type SelectorSource,
  type ValModule,
  type ValModules,
} from "@valbuild/core";
import {
  PatchId,
  createValClient,
  type ValClient,
} from "@valbuild/shared/internal";
import { InMemoryPatchStore, initValServer } from "@valbuild/tanstack/server";
import { loadValModules } from "@valbuild/server";

type Operation = "load" | "draft" | "draft-novalidate" | "base";
const OPERATIONS: Operation[] = ["load", "draft", "draft-novalidate", "base"];

/** What each operation is, in the product's terms. */
const DESCRIBE: Record<Operation, string> = {
  load: "modules loaded and the server answering /stat (the baseline)",
  draft:
    "PUT /sources/~ validated: what a draft-mode fetchVal asks, once per request",
  "draft-novalidate": "the same without validation (previews still computed)",
  base: "PUT /sources/~ unpatched and unvalidated: BaseAlignment's fetch",
};

const INPUTS = [
  "web",
  "synth:1",
  "synth:5",
  "synth:10",
  "synth:20",
  "synth:1+650",
] as const;
type Input = (typeof INPUTS)[number];

const MB = 1024 * 1024;

// ---------------------------------------------------------------------------
// Inputs

const { s, c, config } = initVal({});

const item = s.object({
  title: s.string(),
  summary: s.string(),
  body: s.richtext({ bold: true }),
  tags: s.array(s.string()),
});

/** About `megabytes` of content, in 20 record modules of equal size. */
function synthetic(megabytes: number): {
  modules: ValModule<SelectorSource>[];
  bytes: number;
} {
  const moduleCount = 20;
  const perModule = (megabytes * MB) / moduleCount;
  const sample = entry(0, 0);
  const entryBytes = JSON.stringify(sample).length + 12;
  const entries = Math.max(1, Math.round(perModule / entryBytes));
  const modules: ValModule<SelectorSource>[] = [];
  let bytes = 0;
  for (let m = 0; m < moduleCount; m++) {
    const source: Record<string, ReturnType<typeof entry>> = {};
    for (let i = 0; i < entries; i++) source[`entry-${i}`] = entry(m, i);
    bytes += JSON.stringify(source).length;
    modules.push(c.define(`/content/m${m}.val.ts`, s.record(item), source));
  }
  return { modules, bytes };
}

function entry(m: number, i: number) {
  return {
    title: `Module ${m}, entry ${i}`,
    summary: `A summary of entry ${i} in module ${m}. `.repeat(6),
    body: [
      {
        tag: "p" as const,
        children: [
          `Paragraph one of entry ${i}. `.repeat(4),
          {
            tag: "span" as const,
            styles: ["bold" as const],
            children: ["Bold words"],
          },
        ],
      },
      {
        tag: "p" as const,
        children: [`Paragraph two of entry ${i}. `.repeat(4)],
      },
    ],
    tags: ["alpha", "beta", "gamma"],
  };
}

async function loadInput(input: Input): Promise<{
  valModules: ValModules;
  bytes: number;
  patches: number;
  /** Where a chain of patches goes: the first module. */
  target: ModuleFilePath | null;
}> {
  if (input === "web") {
    // valbuild/web, a real production site, evaluated the way `val validate`
    // does it (node:vm). Its own config is in the registry.
    const valModules = loadValModules(path.resolve("/home/user/web"));
    let bytes = 0;
    for (const entry of valModules.modules) {
      const module = (await entry.def()).default;
      bytes += JSON.stringify(Internal.getSource(module) ?? null).length;
    }
    return { valModules, bytes, patches: 0, target: null };
  }
  const [size, chain] = input.slice("synth:".length).split("+");
  const { modules, bytes } = synthetic(Number(size));
  return {
    valModules: defineModules(
      config,
      modules.map((module) => ({
        def: () => Promise.resolve({ default: module }),
      })),
    ),
    bytes,
    patches: chain === undefined ? 0 : Number(chain),
    target: moduleFilePathOf(modules[0]),
  };
}

function moduleFilePathOf(module: ValModule<SelectorSource>): ModuleFilePath {
  const sourcePath = Internal.getValPath(module);
  if (sourcePath === undefined) throw new Error("a module without a path");
  return Internal.splitModuleFilePathAndModulePath(sourcePath)[0];
}

// ---------------------------------------------------------------------------
// One run

async function serverFor(valModules: ValModules): Promise<ValClient> {
  const { valApiHandler } = initValServer(valModules, config, {
    sourceFiles: {},
    patchStore: new InMemoryPatchStore(),
    unsafelyAllowUnauthenticated: true,
    draftMode: {
      isEnabled: async () => true,
      enable: async () => {},
      disable: async () => {},
    },
  });
  return createValClient("/api/val", null, {
    fetch: (input, init) =>
      valApiHandler(new Request(new URL(input, "http://localhost").href, init)),
  });
}

async function seedChain(
  client: ValClient,
  count: number,
  path: ModuleFilePath | null,
): Promise<void> {
  if (count === 0 || path === null) return;
  const stat = await client("/stat", "POST", { body: null });
  if (stat.status !== 200 || !("baseSha" in stat.json)) {
    throw new Error(`/stat answered ${stat.status}`);
  }
  for (let i = 0; i < count; i++) {
    const saved = await client("/patches", "PUT", {
      body: {
        parentRef: { type: "head", headBaseSha: stat.json.baseSha },
        patches: [
          {
            path,
            patchId: PatchId.parse(
              `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
            ),
            patch: [
              {
                op: "replace",
                path: [`entry-${i % 50}`, "title"],
                value: `Edit ${i}`,
              },
            ],
          },
        ],
      },
    });
    if (saved.status !== 200) throw new Error(`PUT /patches: ${saved.status}`);
  }
}

async function runOperation(client: ValClient, op: Operation): Promise<void> {
  if (op === "load") {
    const stat = await client("/stat", "POST", { body: null });
    if (stat.status !== 200) throw new Error(`/stat answered ${stat.status}`);
    return;
  }
  const res = await client("/sources/~", "PUT", {
    path: undefined,
    query:
      op === "base"
        ? {
            apply_patches: false,
            exclude_patches: true,
            validate_sources: false,
            validate_binary_files: false,
          }
        : {
            apply_patches: undefined,
            exclude_patches: undefined,
            validate_sources: op === "draft",
            validate_binary_files: false,
          },
  });
  if (res.status !== 200) {
    throw new Error(`/sources/~ answered ${res.status}`);
  }
}

function heapMB(): number {
  globalThis.gc?.();
  return v8.getHeapStatistics().used_heap_size / MB;
}

/** One input and operation, in this process: times, and heap retained. */
async function measure(input: Input, op: Operation, repeats: number) {
  const before = heapMB();
  const { valModules, bytes, patches, target } = await loadInput(input);
  const client = await serverFor(valModules);
  await seedChain(client, patches, target);
  await runOperation(client, "load");
  const loaded = heapMB();
  const times: number[] = [];
  for (let i = 0; i < repeats; i++) {
    const start = performance.now();
    await runOperation(client, op);
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
function minimumHeap(input: Input, op: Operation): number | null {
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
    const op = OPERATIONS.find((o) => o === opArg);
    if (input === undefined || op === undefined) {
      throw new Error(`unknown input or operation: ${inputArg} ${opArg}`);
    }
    const result = await measure(input, op, Number(repeatsArg ?? 5));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (mode !== "all") {
    throw new Error("usage: draftRead.ts all | run <input> <op> [repeats]");
  }
  const rows = [];
  for (const input of INPUTS) {
    for (const op of OPERATIONS) {
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
      const heap = minimumHeap(input, op);
      rows.push({ ...result, minHeapMB: heap });
      process.stderr.write(`${input} ${op}: ${JSON.stringify(rows.at(-1))}\n`);
    }
  }
  process.stdout.write(`${JSON.stringify({ describe: DESCRIBE, rows })}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});
