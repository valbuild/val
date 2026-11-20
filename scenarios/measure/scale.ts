/**
 * Phase 10 of `docs/plans/one-content-model.md`: the Studio's surfaces at
 * size, TIMED, with the heap after each. The same project and the same
 * surfaces as `src/scale.scenario.test.ts`, which counts the work
 * (`scaleWork.ts` holds both).
 *
 * What runs: TanStack's real `initValServer` route handler in memory mode,
 * and the Studio's real system (`createValSystem` on the real client, as
 * `ValStoreProvider` starts it) talking to it in this process. Validation runs
 * in-process, where the Studio runs it in a worker; React is not here, so a
 * time is what the stores and the server cost, not the render.
 *
 * Not a test: it prints. Run from `scenarios/`, on a quiet machine:
 *
 *   pnpm exec tsx measure/scale.ts all                    # 1k, 10k, 100k; local and remote
 *   VAL_SCALE=1000,10000 pnpm exec tsx measure/scale.ts all
 *   node --expose-gc --import tsx measure/scale.ts run 10000 local
 *
 * `all` runs each size in a child process of its own (`--expose-gc`), one
 * after the other, so one run's heap is not in the next. The heap is
 * `used_heap_size` after a `gc()`: what is RETAINED after each surface, by the
 * server and the Studio together (they share this process, as they do in the
 * demo's tab). A surface that does not finish in `VAL_SCALE_STEP_TIMEOUT` ms
 * (default 600,000) is reported with how many requests it had made by then,
 * and the run ends there: what it started is still running, and would be in
 * every later number.
 */
import { spawnSync } from "child_process";
import { performance } from "perf_hooks";
import v8 from "v8";
import { modules as defineModules } from "@valbuild/core";
import { createValClient } from "@valbuild/shared/internal";
import { InMemoryPatchStore, initValServer } from "@valbuild/tanstack/server";
import { createValSystem } from "../../packages/ui/spa/stores/react/createValSystem";
import { SchemaValidator } from "../../packages/ui/spa/validation/validateModule";
import { statSnapshotOf } from "../../packages/ui/spa/stores/react/statSnapshotOf";
import {
  requestStat,
  statStateAfterAnswer,
} from "../../packages/ui/spa/hooks/useStatus";
import type { System } from "../../packages/ui/spa/stores/createSystem";
import {
  FEATURED,
  IMAGES,
  POSTS,
  SCALE_SIZES,
  discardAll,
  inspectLibraryEntry,
  keyOfDropdown,
  keystroke,
  openEntry,
  openPicker,
  openRecord,
  pick,
  postKey,
  scaleConfig as config,
  scaleProject,
  scaleSizesFrom,
  search,
  validateAll,
  type MediaRefs,
} from "./scaleWork";

const MB = 1024 * 1024;
const STEP_TIMEOUT = Number(process.env.VAL_SCALE_STEP_TIMEOUT ?? 600_000);
const KEYSTROKES = 20;

function heapMB(): number {
  globalThis.gc?.();
  return Math.round((v8.getHeapStatistics().used_heap_size / MB) * 10) / 10;
}

/** A step ran out of time: the run reports what it has and stops. */
class Stopped extends Error {}

type Step = {
  step: string;
  ms: number | null;
  heapMB: number;
  requests: number;
  note?: string;
};

async function run(n: number, media: MediaRefs) {
  const steps: Step[] = [];
  const outcome = {
    entries: n,
    media,
    baselineHeapMB: heapMB(),
    rssMB: 0,
    imports: 0,
    steps,
  };
  try {
    outcome.imports = await runSteps(n, media, steps);
  } catch (error) {
    if (!(error instanceof Stopped)) throw error;
  }
  outcome.rssMB = Math.round(process.memoryUsage().rss / MB);
  return outcome;
}

/** The steps, in order; answers how many entries were imported. */
async function runSteps(
  n: number,
  media: MediaRefs,
  steps: Step[],
): Promise<number> {
  let requests = 0;
  const step = async <T>(
    name: string,
    fn: () => Promise<T>,
    note?: (value: T) => string,
  ): Promise<T> => {
    const before = requests;
    // Said before and after, on stderr, so a run the process does not
    // survive (out of memory) still says how far it got: see `main`.
    process.stderr.write(`START ${name}\n`);
    const start = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const value = await Promise.race([
        fn(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`timed out after ${STEP_TIMEOUT} ms`)),
            STEP_TIMEOUT,
          );
        }),
      ]);
      const ms = Math.round((performance.now() - start) * 10) / 10;
      steps.push({
        step: name,
        ms,
        heapMB: heapMB(),
        requests: requests - before,
        ...(note !== undefined ? { note: note(value) } : {}),
      });
      process.stderr.write(`STEP ${JSON.stringify(steps.at(-1))}\n`);
      return value;
    } catch (error) {
      steps.push({
        step: name,
        ms: null,
        heapMB: heapMB(),
        requests: requests - before,
        note: String(error),
      });
      throw new Stopped(String(error));
    } finally {
      clearTimeout(timer);
    }
  };

  const project = await step("generate the project", async () =>
    scaleProject({ entries: n, media }),
  );
  const registry = defineModules(
    config,
    project.modules.map((module) => ({
      def: () => Promise.resolve({ default: module }),
    })),
  );

  const handler = await step("server: start and first /stat", async () => {
    const { valApiHandler } = initValServer(registry, config, {
      sourceFiles: project.sourceText([postKey(1)]),
      patchStore: new InMemoryPatchStore(),
      unsafelyAllowUnauthenticated: true,
      draftMode: {
        isEnabled: async () => true,
        enable: async () => {},
        disable: async () => {},
      },
    });
    await valApiHandler(
      new Request("http://localhost/api/val/stat", {
        method: "POST",
        body: "null",
        headers: { "content-type": "application/json" },
      }),
    );
    return valApiHandler;
  });
  const client = createValClient("/api/val", null, {
    fetch: (input, init) => {
      requests++;
      return handler(
        new Request(new URL(input, "http://localhost").href, init),
      );
    },
  });

  /** A Studio, as `ValStoreProvider` starts one: intake, then /stat. */
  const startStudio = async (): Promise<System> => {
    const validator = new SchemaValidator();
    const system = createValSystem(client, {
      writes: true,
      mode: "fs",
      schemaValidation: {
        validate: async (moduleFilePath, source, serializedSchema, version) =>
          validator.validate(moduleFilePath, source, serializedSchema, version),
      },
    });
    await system.host.reloadCode(registry);
    await askStat(system);
    return system;
  };
  /** One /stat, answered at once (no long poll), taken in as the hook does. */
  const askStat = async (system: System) => {
    const res = await requestStat(client, { status: "not-asked" });
    const next = statStateAfterAnswer(
      { status: "not-asked" },
      res,
      false,
      Date.now(),
    );
    if (next !== null && "data" in next && next.data) {
      system.stat.receiveStat(statSnapshotOf(next.data));
    }
  };
  /** What a Studio does after a write: the save goes out, /stat comes back. */
  const settle = async (system: System) => {
    await system.patchSync.flush();
    await askStat(system);
  };

  const editor = await step("Studio: cold start", startStudio);
  await step(
    "open the record",
    () => openRecord(editor, POSTS, project.postKeys),
    (opened) => `${opened.window.length} rows`,
  );
  const key = postKey(0);
  await step("open one post", () =>
    openEntry(editor, POSTS, key, ["title", "slug", "image"]),
  );

  const typing = async (label: string) => {
    const times: number[] = [];
    let value = "";
    for (let i = 0; i < KEYSTROKES; i++) {
      value += "a";
      const start = performance.now();
      await keystroke(editor, POSTS, [key, "title"], value);
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    steps.push({
      step: label,
      ms: Math.round(times[Math.floor(times.length / 2)] * 100) / 100,
      heapMB: heapMB(),
      requests: 0,
      note: `median of ${KEYSTROKES}; p90 ${Math.round(times[Math.floor(times.length * 0.9)] * 100) / 100} ms`,
    });
    process.stderr.write(`STEP ${JSON.stringify(steps.at(-1))}\n`);
    await step("  ... the saves and /stat after it", () => settle(editor));
  };
  await typing("keystroke in a post (Studio)");

  await step(
    "open the image picker",
    () => openPicker(editor, IMAGES),
    (picker) => `${picker.rows} rows`,
  );
  await step("pick the library's last image", async () => {
    await pick(editor, FEATURED, ["hero"], IMAGES, project.imagePaths[n - 1]);
    await settle(editor);
  });
  await step("keyOf dropdown", () => keyOfDropdown(editor, POSTS));
  await step("validate everything", () => validateAll(editor));
  await step("discard all", async () => {
    const res = await discardAll(editor);
    await askStat(editor);
    return res;
  });

  const target = postKey(1);
  await openEntry(editor, POSTS, target, ["title"]);
  const edit = await keystroke(editor, POSTS, [target, "title"], "Published");
  await settle(editor);
  await step(
    "publish one post",
    async () => {
      const res = await editor.publish([edit]);
      await askStat(editor);
      return res;
    },
    (res) => res.status,
  );

  await step("select an image in the gallery (loads every post)", () =>
    inspectLibraryEntry(editor, IMAGES, project.imagePaths[n - 1]),
  );
  await typing("keystroke in a post, every post loaded (Studio)");

  const searcher = await step("Studio: a second cold start", startStudio);
  await step(
    "search, one query (loads every post)",
    () => search(searcher, `Post number ${n - 1}`),
    (found) =>
      `${found.last.status === "results" ? found.last.total : 0} hits after loading`,
  );
  await step("validate everything, every post loaded", () =>
    validateAll(searcher),
  );

  editor.dispose();
  searcher.dispose();
  return project.imports.count;
}

function table(results: Array<Awaited<ReturnType<typeof run>>>): string {
  const lines: string[] = [];
  for (const result of results) {
    lines.push(
      "",
      `### ${result.entries} entries, ${result.media} media (baseline heap ${result.baselineHeapMB} MB, RSS at the end ${result.rssMB} MB, ${result.imports} entry imports)`,
      "",
      "| Step | ms | Heap after (MB) | Requests | Note |",
      "| --- | --- | --- | --- | --- |",
      ...result.steps.map(
        (s) =>
          `| ${s.step} | ${s.ms ?? "-"} | ${s.heapMB} | ${s.requests} | ${s.note ?? ""} |`,
      ),
    );
  }
  return lines.join("\n");
}

async function main() {
  const [mode, nArg, mediaArg] = process.argv.slice(2);
  if (mode === "run") {
    const n = Number(nArg);
    if (!(n > 0) || (mediaArg !== "local" && mediaArg !== "remote")) {
      throw new Error("usage: scale.ts run <entries> <local|remote>");
    }
    const result = await run(n, mediaArg);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    // A step that ran out of time is still running: do not wait for it.
    process.exit(0);
  }
  if (mode !== "all") {
    throw new Error("usage: scale.ts all | run <entries> <local|remote>");
  }
  const sizes = scaleSizesFrom(process.env.VAL_SCALE, SCALE_SIZES);
  const medias: MediaRefs[] = ["local", "remote"];
  const results = [];
  for (const n of sizes) {
    for (const media of medias) {
      const child = spawnSync(
        process.execPath,
        [
          "--expose-gc",
          "--max-old-space-size=8192",
          "--import",
          "tsx",
          __filename,
          "run",
          String(n),
          media,
        ],
        {
          encoding: "utf8",
          cwd: process.cwd(),
          maxBuffer: 64 * MB,
        },
      );
      if (child.status !== 0) {
        // The steps it finished, and the one it died in.
        const lines = child.stderr.split("\n");
        const steps: Step[] = lines
          .filter((line) => line.startsWith("STEP "))
          .map((line) => JSON.parse(line.slice("STEP ".length)));
        const started = lines
          .filter((line) => line.startsWith("START "))
          .at(-1)
          ?.slice("START ".length);
        const fatal =
          lines.find((line) => line.includes("FATAL ERROR")) ??
          `exited ${child.status ?? child.signal}`;
        if (started !== undefined && steps.at(-1)?.step !== started) {
          steps.push({
            step: started,
            ms: null,
            heapMB: Number.NaN,
            requests: 0,
            note: `the process died: ${fatal.trim()}`,
          });
        }
        const result = {
          entries: n,
          media,
          baselineHeapMB: Number.NaN,
          rssMB: Number.NaN,
          imports: Number.NaN,
          steps,
        };
        results.push(result);
        process.stderr.write(`${table([result])}\n`);
        continue;
      }
      const line = child.stdout.trim().split("\n").at(-1) ?? "{}";
      const result = JSON.parse(line);
      results.push(result);
      process.stderr.write(`${table([result])}\n`);
    }
  }
  process.stdout.write(`${table(results)}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});
