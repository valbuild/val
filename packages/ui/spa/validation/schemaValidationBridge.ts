import type { ValidationErrors } from "@valbuild/core";
import type { SchemaValidationBridge } from "../stores/bridges";
import type {
  ValidationWorkerRequest,
  ValidationWorkerResponse,
} from "./worker-types";
import { SchemaValidator } from "./validateModule";

/**
 * Schema validation on a real worker thread, as a promise.
 *
 * ## Why this exists rather than `ValidationWorkerClient`
 *
 * The same worker, a different shape. `ValidationWorkerClient` is
 * fire-and-forget — `validate()` returns `void` and the result arrives on a
 * callback later — because `ValSyncEngine` pushed results into its own
 * invalidation machinery rather than awaiting them. `SchemaValidationBridge`
 * asks a question and gets an answer, which is what `ValidationStore` needs in
 * order to share an in-flight validation between N fields asking at once.
 *
 * ## Why it must be a worker
 *
 * Validating a module walks its whole source against its whole schema, and the
 * Studio validates the module a field is in. Doing that on the main thread is
 * the blocking that makes typing feel bad — which is precisely what the store
 * system's realm split exists to avoid, and the seam it crosses here is a real
 * one: source and schema are passed as ARGUMENTS, so nothing on the worker side
 * holds a reference to a store, and nothing carries a closure. (That is the rule
 * the engine broke: it posted `valModules` itself, lazy-import thunks and all,
 * and every module with `.jsonValues()` failed to validate with a
 * `DataCloneError`.)
 *
 * ## The fallback is deliberate, and it is not silent
 *
 * A browser that cannot create the worker — an old one, a restrictive CSP — gets
 * validation on the main thread rather than no validation at all. Slower, and it
 * says so once; publishing without a validation gate would be worse than slow.
 */
export function createSchemaValidationBridge(): SchemaValidationBridge {
  let worker: Worker | null = null;
  let failed = false;
  let requestId = 0;
  const pending = new Map<
    string,
    {
      resolve: (errors: ValidationErrors) => void;
      reject: (error: Error) => void;
    }
  >();
  /** Only constructed if the worker cannot be. */
  let fallback: SchemaValidator | null = null;

  function ensureWorker(): Worker | null {
    if (worker !== null || failed) {
      return worker;
    }
    try {
      // `new URL(..., import.meta.url)` is what Vite rewrites into an absolute,
      // base-prefixed asset URL, so the worker resolves wherever the SPA is
      // served from.
      worker = new Worker(new URL("./validation.worker.ts", import.meta.url), {
        type: "module",
      });
      worker.onmessage = (event: MessageEvent<ValidationWorkerResponse>) => {
        const response = event.data;
        const waiting = pending.get(response.id);
        if (waiting === undefined) return;
        pending.delete(response.id);
        if (response.type === "result") {
          waiting.resolve(response.errors);
        } else {
          waiting.reject(new Error(response.error));
        }
      };
      worker.onerror = (event) => {
        // Every outstanding request, not just the current one: the worker is
        // gone, so none of them will ever be answered, and a promise that never
        // settles is a field that spins forever.
        const error = new Error(
          `Validation worker failed: ${event.message ?? "unknown error"}`,
        );
        for (const waiting of pending.values()) waiting.reject(error);
        pending.clear();
        worker?.terminate();
        worker = null;
        failed = true;
      };
    } catch (error) {
      console.warn(
        "Val: could not create the validation worker; validating on the main thread instead.",
        error,
      );
      failed = true;
      worker = null;
    }
    return worker;
  }

  return {
    async validate(moduleFilePath, source, serializedSchema, schemaVersion) {
      const active = ensureWorker();
      if (active === null) {
        fallback ??= new SchemaValidator();
        return fallback.validate(
          moduleFilePath,
          source,
          serializedSchema,
          schemaVersion,
        );
      }
      const id = `val-${++requestId}`;
      const answer = new Promise<ValidationErrors>((resolve, reject) => {
        pending.set(id, { resolve, reject });
      });
      const request: ValidationWorkerRequest = {
        type: "validate",
        id,
        moduleFilePath,
        source,
        serializedSchema,
        schemaSha: schemaVersion,
      };
      active.postMessage(request);
      try {
        return await answer;
      } catch (error) {
        // One retry's worth of resilience, on the main thread. The store above
        // caches per (module, schema version), so a module that fell back once
        // is not re-validated on every read.
        console.warn(
          `Val: validation worker could not validate '${moduleFilePath}'; validating on the main thread instead.`,
          error,
        );
        fallback ??= new SchemaValidator();
        return fallback.validate(
          moduleFilePath,
          source,
          serializedSchema,
          schemaVersion,
        );
      }
    },
  };
}
