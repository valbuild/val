import type { JSONValue } from "@valbuild/core/patch";
import type { Evaluated } from "@valbuild/shared/internal";
import type { EvaluateReply, EvaluateRequest } from "./evaluateTree.worker";

/**
 * How long a tree may take to evaluate. Seconds is normal -- a project's Val
 * modules and the vendor chunks they import -- and this is the difference
 * between an update that fails, saying so, and one that never ends.
 */
const DEADLINE_MS = 2 * 60_000;

/** One tree's bundle, evaluated in a worker of its own: see `evaluateTree.worker.ts`. */
export function evaluateTree(
  code: string,
  sources: Record<string, JSONValue | null>,
): Promise<Evaluated> {
  const worker = new Worker(
    new URL("./evaluateTree.worker.ts", import.meta.url),
    { type: "module" },
  );
  return new Promise<Evaluated>((resolve, reject) => {
    const done = () => {
      clearTimeout(deadline);
      worker.terminate();
    };
    const deadline = setTimeout(() => {
      done();
      reject(
        new Error(
          `Reading the project's Val modules did not finish within ${DEADLINE_MS / 1000} seconds.`,
        ),
      );
    }, DEADLINE_MS);
    worker.onmessage = (event: MessageEvent<EvaluateReply>) => {
      done();
      if (event.data.ok) resolve(event.data.evaluated);
      else
        reject(
          new Error(
            `The project's Val modules could not be read: ${event.data.message}`,
          ),
        );
    };
    worker.onerror = (event) => {
      done();
      reject(
        new Error(
          `The project's Val modules could not be read: ${event.message || "the worker failed"}`,
        ),
      );
    };
    const request: EvaluateRequest = { code, sources };
    worker.postMessage(request);
  });
}
