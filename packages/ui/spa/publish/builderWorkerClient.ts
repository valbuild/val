import type {
  BuilderReply,
  BuilderRequest,
  BuilderResult,
} from "./builderProtocol";
import type { StudioBuilder } from "./loadBuilder";

/**
 * The Studio's side of the builder worker: `StudioBuilder`, answered by
 * `builder.worker.ts`. Why the builder runs in a worker is on `importBuilder`
 * in `loadBuilder.ts`.
 */

/**
 * How long one call may take before it is given up on.
 *
 * Not a guess at how long a build takes -- a real one is seconds -- but the
 * difference between a publish that FAILS, which says so and can be retried,
 * and one that spins with no way out. A worker cannot deadlock the way the
 * page could, so reaching this is a bug worth hearing about, not a timeout
 * worth tuning.
 */
const CALL_DEADLINE_MS = 5 * 60_000;

export function workerBuilder(options: {
  onBroken: () => void;
}): Promise<StudioBuilder> {
  const worker = new Worker(new URL("./builder.worker.ts", import.meta.url), {
    type: "module",
  });
  const waiting = new Map<
    number,
    {
      method: BuilderResult["method"];
      settle: (outcome: { result: BuilderResult } | { error: Error }) => void;
    }
  >();
  let nextId = 0;
  let broken: Error | null = null;
  /*
   * A worker that dies answers nothing, so every outstanding call is failed
   * here -- and the load is forgotten, so the next publish starts a new one.
   */
  const breakAll = (error: Error) => {
    broken = error;
    for (const call of waiting.values()) call.settle({ error });
    waiting.clear();
    worker.terminate();
    options.onBroken();
  };

  const ready = new Promise<void>((resolve, reject) => {
    worker.onerror = (event) => {
      const error = new Error(
        `The site builder stopped: ${event.message || "the worker failed to start"}.`,
      );
      reject(error);
      breakAll(error);
    };
    worker.onmessage = (event: MessageEvent<BuilderReply>) => {
      const reply = event.data;
      if (reply.type === "ready") {
        resolve();
        return;
      }
      if (reply.type === "load-failed") {
        const error = new Error(reply.message);
        reject(error);
        breakAll(error);
        return;
      }
      const call = waiting.get(reply.id);
      if (call === undefined) return;
      waiting.delete(reply.id);
      if (reply.type === "error") {
        call.settle({ error: new Error(reply.message) });
      } else {
        call.settle({ result: reply });
      }
    };
  });
  const wasmUrl: unknown = Reflect.get(globalThis, "__VAL_ROLLDOWN_WASM_URL__");
  const init: BuilderRequest = {
    type: "init",
    wasmUrl: typeof wasmUrl === "string" ? wasmUrl : null,
  };
  worker.postMessage(init);

  /** Send one call, and answer with what came back for it. */
  const send = (
    call: Extract<BuilderRequest, { type: "call" }>,
  ): Promise<BuilderResult> =>
    new Promise((resolve, reject) => {
      if (broken !== null) {
        reject(broken);
        return;
      }
      const timer = setTimeout(() => {
        breakAll(
          new Error(
            `The site builder did not answer ${call.method} within ` +
              `${CALL_DEADLINE_MS / 60_000} minutes, so it was stopped.`,
          ),
        );
      }, CALL_DEADLINE_MS);
      waiting.set(call.id, {
        method: call.method,
        settle: (outcome) => {
          clearTimeout(timer);
          if ("error" in outcome) reject(outcome.error);
          else resolve(outcome.result);
        },
      });
      worker.postMessage(call);
    });

  const mismatch = (wanted: string, got: string) =>
    new Error(`The site builder answered ${got} to a ${wanted} call.`);

  const builder: StudioBuilder = {
    bakedGit: async (...args) => {
      const result = await send({
        type: "call",
        id: nextId++,
        method: "bakedGit",
        args,
      });
      if (result.method !== "bakedGit")
        throw mismatch("bakedGit", result.method);
      return result.value;
    },
    rebakeGit: async (...args) => {
      const result = await send({
        type: "call",
        id: nextId++,
        method: "rebakeGit",
        args,
      });
      if (result.method !== "rebakeGit")
        throw mismatch("rebakeGit", result.method);
      return result.value;
    },
    buildUserApp: async (...args) => {
      const result = await send({
        type: "call",
        id: nextId++,
        method: "buildUserApp",
        args,
      });
      if (result.method !== "buildUserApp")
        throw mismatch("buildUserApp", result.method);
      return result.value;
    },
    publishArtifacts: async (...args) => {
      const result = await send({
        type: "call",
        id: nextId++,
        method: "publishArtifacts",
        args,
      });
      if (result.method !== "publishArtifacts") {
        throw mismatch("publishArtifacts", result.method);
      }
      return result.value;
    },
  };
  return ready.then(() => builder);
}
