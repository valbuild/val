import {
  SourceError,
  type TypecheckProgress,
  type TypecheckResult,
} from "@valbuild/shared/typecheck";
import {
  TypecheckAbandoned,
  type TypecheckReply,
  type TypecheckRequest,
} from "./typecheckProtocol";

/**
 * Where the Studio's typecheck gets adept's type bundles and compilers: its
 * own server's publish proxy, which forwards to content with the session.
 */
export const STUDIO_ADEPT_BASE = "/api/val/publish-api/adept";

/**
 * The Studio's side of the typecheck worker. Imported with `import()`, as
 * `builderWorkerClient.ts` is: the worker's URL is `import.meta.url`'s.
 *
 * One worker answers every check, so the compiler it evaluated for the base
 * is there for the upgrade. A check that is abandoned (`signal`) stops the
 * worker -- a program half built is not worth finishing -- and the next
 * check starts a new one.
 *
 * Checks run one at a time; abandoning one abandons any queued behind it.
 * Failures are {@link SourceError}s, with adept's own code and whether
 * trying again can help; `status` 401 is a signed-out session.
 */
export type Typechecker = {
  check(
    input: {
      files: Record<string, string>;
      lockfile: string;
      workspace?: string | null;
    },
    options?: {
      onProgress?: (progress: TypecheckProgress) => void;
      signal?: AbortSignal;
    },
  ): Promise<TypecheckResult>;
  dispose(): void;
};

export function createTypechecker(
  options: { base?: string } = {},
): Typechecker {
  const base = options.base ?? STUDIO_ADEPT_BASE;
  let worker: Worker | null = null;
  let nextId = 0;
  const waiting = new Map<
    number,
    {
      onProgress: (progress: TypecheckProgress) => void;
      settle: (outcome: { result: TypecheckResult } | { error: Error }) => void;
    }
  >();
  const stop = (error: Error) => {
    worker?.terminate();
    worker = null;
    for (const call of waiting.values()) call.settle({ error });
    waiting.clear();
  };
  const start = (): Worker => {
    if (worker !== null) return worker;
    const started = new Worker(
      new URL("./typecheck.worker.ts", import.meta.url),
      { type: "module" },
    );
    started.onerror = (event) => {
      event.preventDefault();
      stop(
        new SourceError(
          `The typecheck stopped: ${event.message || "its worker failed to start"}.`,
          "worker-failed",
          true,
        ),
      );
    };
    started.onmessage = (event: MessageEvent<TypecheckReply>) => {
      const message = event.data;
      const call = waiting.get(message.id);
      if (call === undefined) return;
      if (message.type === "progress") {
        call.onProgress(message.progress);
        return;
      }
      waiting.delete(message.id);
      if (message.type === "result") {
        call.settle({ result: message.result });
      } else {
        const { message: text, code, retryable, status } = message.failure;
        call.settle({ error: new SourceError(text, code, retryable, status) });
      }
    };
    worker = started;
    return started;
  };

  return {
    check(input, callOptions = {}) {
      return new Promise((resolve, reject) => {
        const signal = callOptions.signal;
        if (signal?.aborted) {
          reject(new TypecheckAbandoned());
          return;
        }
        const id = nextId++;
        const onAbort = () => stop(new TypecheckAbandoned());
        signal?.addEventListener("abort", onAbort, { once: true });
        waiting.set(id, {
          onProgress: callOptions.onProgress ?? (() => {}),
          settle: (outcome) => {
            signal?.removeEventListener("abort", onAbort);
            if ("error" in outcome) reject(outcome.error);
            else resolve(outcome.result);
          },
        });
        const request: TypecheckRequest = {
          type: "check",
          id,
          files: input.files,
          lockfile: input.lockfile,
          workspace: input.workspace ?? null,
          base,
        };
        start().postMessage(request);
      });
    },
    dispose() {
      stop(new TypecheckAbandoned());
    },
  };
}
