/**
 * The Cloudflare isolate probe: a draft read on Val's real server, in a
 * Worker, so the 128 MB limit can be found where it is enforced.
 *
 * Each request runs one input and one operation through the same code
 * `draftRead.ts` drives in Node (`draftReadWork.ts`), on Val's server in
 * memory mode as `@valbuild/server/browser` starts it: `ValServer`, the
 * router and `ValOpsMemory`, with the browser's `ValServerPlatform`, because
 * a Worker has no `fs`. The requests go through `ValClient`, as a draft-mode
 * `fetchVal` sends them.
 *
 * What it cannot report is memory: a Worker has no `performance.memory` and
 * no heap statistics. Memory is judged by Cloudflare: a request that takes the
 * isolate over 128 MB ends with the outcome `exceededMemory` in
 * `wrangler tail`, and the client gets error 1102. So the driver
 * (`../isolateProbe.ts`) steps the input up until that happens. See "The
 * deployed isolate probe" in `../README.md`.
 *
 * The isolate keeps the last input's modules and server between requests, as
 * a site's isolate keeps its bundle and (after phase 6) one runtime: the
 * retained heap of one request is there for the next. A different input
 * replaces them; `fresh=1` replaces them anyway.
 */
import type { ValConfig, ValModules } from "@valbuild/core";
import { createInTabValFetch } from "@valbuild/server/browser";
import { createValClient, type ValClient } from "@valbuild/shared/internal";
import {
  MB,
  OPERATIONS,
  DESCRIBE,
  contentBytes,
  parseSyntheticInput,
  runOperation,
  seedChain,
  syntheticInput,
  type LoadedInput,
  type Operation,
} from "../draftReadWork";

export type ProbeOptions = {
  /** valbuild/web's modules, when this build bundles them; `input=web`. */
  web: ValModules | null;
};

/** What `GET /run` answers when the request completed. */
export type ProbeRun = {
  ok: true;
  /** The `id` query parameter, echoed: the driver joins tail events on it. */
  id: string | null;
  isolate: IsolateInfo;
  input: string;
  op: Operation;
  contentBytes: number;
  modules: number;
  patches: number;
  ballastMB: number;
  /** Whether this request built the input, or found it held from the last. */
  built: boolean;
  /**
   * The isolate's own clock, in ms. In a DEPLOYED Worker that clock only
   * moves on I/O (Cloudflare's timing mitigation), so these can read 0 there:
   * the tail's `cpuTime` and `wallTime` are the numbers to use.
   */
  ms: { build: number; start: number; op: number[] };
};

/** What `GET /run` answers when the request threw. */
export type ProbeFailure = {
  ok: false;
  id: string | null;
  isolate: IsolateInfo;
  stage: "parse" | "build" | "start" | "op";
  error: string;
};

export type IsolateInfo = {
  /** Random per isolate: a new id means the previous isolate is gone. */
  id: string;
  /** Requests this isolate has served, this one included. */
  requests: number;
  startedAt: string;
};

type Held = {
  key: string;
  loaded: LoadedInput;
  modules: number;
  client: ValClient;
};

export function createProbe(options: ProbeOptions): {
  fetch: (request: Request) => Promise<Response>;
} {
  // Made on the first request: a Worker may not generate random values in
  // global scope, where `createProbe` is called.
  let isolateId: string | null = null;
  let requests = 0;
  let startedAt = "";
  const isolateInfo = (): IsolateInfo => {
    if (isolateId === null) {
      isolateId = crypto.randomUUID();
      startedAt = new Date().toISOString();
    }
    return { id: isolateId, requests, startedAt };
  };
  let held: Held | null = null;
  let ballast: { mb: number; arrays: number[][] } = { mb: 0, arrays: [] };

  const inputs = [
    "synth:<MB>",
    "synth:<MB>+<patches>",
    ...(options.web ? ["web"] : []),
  ];

  async function load(input: string): Promise<LoadedInput> {
    if (input === "web") {
      if (options.web === null) {
        throw new Error(
          "this build does not bundle valbuild/web: deploy `--env web`",
        );
      }
      const bytes = await contentBytes(options.web);
      return { valModules: options.web, bytes, patches: 0, target: null };
    }
    const parsed = parseSyntheticInput(input);
    if (parsed === null) throw new Error(`unknown input: ${input}`);
    return syntheticInput(parsed.megabytes, parsed.patches);
  }

  async function run(url: URL): Promise<Response> {
    requests++;
    const id = url.searchParams.get("id");
    let stage: ProbeFailure["stage"] = "parse";
    try {
      const input = url.searchParams.get("input") ?? "synth:1";
      const opParam = url.searchParams.get("op") ?? "draft";
      const op = OPERATIONS.find((o) => o === opParam);
      if (op === undefined) throw new Error(`unknown op: ${opParam}`);
      const repeats = Math.max(1, Number(url.searchParams.get("repeats") ?? 1));
      const ballastMB = Math.max(
        0,
        Number(url.searchParams.get("ballast") ?? 0),
      );
      const fresh = url.searchParams.get("fresh") === "1";

      // Ballast stands in for the app's own heap, which shares the isolate.
      if (ballast.mb !== ballastMB) {
        ballast = { mb: 0, arrays: [] };
        ballast = { mb: ballastMB, arrays: allocateBallast(ballastMB) };
      }

      stage = "build";
      const built = fresh || held === null || held.key !== input;
      let buildMs = 0;
      let startMs = 0;
      if (built) {
        // Let go of the last input BEFORE building the next, so the two are
        // never both reachable.
        held = null;
        let t = performance.now();
        const loaded = await load(input);
        await tick();
        buildMs = performance.now() - t;

        stage = "start";
        t = performance.now();
        // The modules carry the config they were defined with.
        const client = serverFor(loaded.valModules, loaded.valModules.config);
        await seedChain(client, loaded.patches, loaded.target);
        await runOperation(client, "load");
        await tick();
        startMs = performance.now() - t;
        held = {
          key: input,
          loaded,
          modules: loaded.valModules.modules.length,
          client,
        };
      }
      if (held === null) throw new Error("nothing held after building");

      stage = "op";
      const times: number[] = [];
      for (let i = 0; i < repeats; i++) {
        const t = performance.now();
        await runOperation(held.client, op);
        await tick();
        times.push(performance.now() - t);
      }
      const body: ProbeRun = {
        ok: true,
        id,
        isolate: isolateInfo(),
        input,
        op,
        contentBytes: held.loaded.bytes,
        modules: held.modules,
        patches: held.loaded.patches,
        ballastMB: ballast.mb,
        built,
        ms: { build: buildMs, start: startMs, op: times },
      };
      return Response.json(body);
    } catch (error) {
      const body: ProbeFailure = {
        ok: false,
        id,
        isolate: isolateInfo(),
        stage,
        error: error instanceof Error ? error.message : String(error),
      };
      return Response.json(body, { status: 500 });
    }
  }

  return {
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/run") return run(url);
      if (url.pathname === "/") {
        return Response.json({
          probe: "val-isolate-probe",
          usage:
            "GET /run?input=synth:5&op=draft&repeats=1&ballast=0&fresh=0&id=<any>",
          inputs,
          ops: DESCRIBE,
          isolate: isolateInfo(),
          note: "Memory is judged by the outcome in `wrangler tail` (exceededMemory), not by this response. See scenarios/measure/README.md.",
        });
      }
      return new Response("Not found", { status: 404 });
    },
  };
}

/** Val's server as `@valbuild/server/browser` starts it, behind `ValClient`. */
function serverFor(valModules: ValModules, config: ValConfig): ValClient {
  const inTabFetch = createInTabValFetch(valModules, { config });
  return createValClient("/api/val", null, { fetch: inTabFetch });
}

/**
 * `mb` MB of doubles on the V8 heap (a `FixedDoubleArray` of 8 bytes an
 * element), not in an `ArrayBuffer`: the app's heap is objects, not buffers.
 */
function allocateBallast(mb: number): number[][] {
  const perMB = MB / 8;
  const arrays: number[][] = [];
  for (let i = 0; i < Math.floor(mb); i++) {
    arrays.push(new Array<number>(perMB).fill(i + 0.5));
  }
  return arrays;
}

/** One trip through the event loop: in a deployed Worker the clock moves on I/O only. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
