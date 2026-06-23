import {
  deserializeSchema,
  ModuleFilePath,
  SelectorSource,
  SerializedSchema,
  Source,
  SourcePath,
  ValidationErrors,
} from "@valbuild/core";
import type {
  ValidationWorkerRequest,
  ValidationWorkerResponse,
} from "./worker-types";

const supportsWorker =
  typeof window !== "undefined" && typeof Worker !== "undefined";

export type ValidationResultCallback = (
  moduleFilePath: ModuleFilePath,
  errors: ValidationErrors,
) => void;

export class ValidationWorkerClient {
  private worker: Worker | null = null;
  // Worker setup is async (dynamic import) so we can keep the import.meta.url
  // reference out of files parsed by Jest. Requests posted before the worker
  // resolves are buffered here.
  private pending: ValidationWorkerRequest[] | null = supportsWorker
    ? []
    : null;
  private requestIdCounter = 0;
  private disposed = false;
  private latestRequestId = new Map<ModuleFilePath, string>();
  // Fallback cache used when the worker is unavailable (jsdom / SSR).
  private fallbackSchemaCache = new Map<
    ModuleFilePath,
    {
      schemaSha: string;
      schema: ReturnType<typeof deserializeSchema>;
    }
  >();

  constructor(private onResult: ValidationResultCallback) {
    if (supportsWorker) {
      void this.setupWorker();
    }
  }

  private async setupWorker(): Promise<void> {
    try {
      const { createValidationWorker } =
        await import("./createValidationWorker");
      const worker = createValidationWorker();
      // dispose() may have been called while the dynamic import was in flight —
      // don't install a worker the client no longer owns (it would leak the
      // thread and keep handlers alive).
      if (this.disposed) {
        worker.terminate();
        return;
      }
      worker.onmessage = (event: MessageEvent<ValidationWorkerResponse>) => {
        const response = event.data;
        if (this.latestRequestId.get(response.moduleFilePath) !== response.id) {
          return;
        }
        if (response.type === "result") {
          this.onResult(response.moduleFilePath, response.errors);
        } else {
          console.error(
            "Validation worker error:",
            response.moduleFilePath,
            response.error,
          );
          // Surface a "no errors" result so the engine doesn't hold stale state
          // forever — bugs in the worker shouldn't block publishing.
          this.onResult(response.moduleFilePath, false);
        }
      };
      worker.onerror = (event) => {
        console.error("Validation worker crashed:", event.message);
      };
      this.worker = worker;
      const buffered = this.pending;
      this.pending = null;
      if (buffered) {
        for (const request of buffered) {
          // Only flush requests that are still the latest for their module.
          if (this.latestRequestId.get(request.moduleFilePath) === request.id) {
            worker.postMessage(request);
          }
        }
      }
    } catch (error) {
      console.error(
        "Failed to create validation worker:",
        error instanceof Error ? error.message : String(error),
      );
      this.pending = null;
    }
  }

  validate(
    moduleFilePath: ModuleFilePath,
    source: Source,
    serializedSchema: SerializedSchema,
    schemaSha: string,
  ): void {
    const id = `val-${this.requestIdCounter++}`;
    this.latestRequestId.set(moduleFilePath, id);
    const request: ValidationWorkerRequest = {
      type: "validate",
      id,
      moduleFilePath,
      schemaSha,
      serializedSchema,
      source,
    };
    if (this.worker) {
      this.worker.postMessage(request);
      return;
    }
    if (this.pending) {
      // Drop any stale buffered request for the same module — only the most
      // recent matters once the worker comes online.
      this.pending = this.pending.filter(
        (req) => req.moduleFilePath !== moduleFilePath,
      );
      this.pending.push(request);
      return;
    }
    // Main-thread fallback (tests, SSR, or worker construction failed).
    try {
      let cached = this.fallbackSchemaCache.get(moduleFilePath);
      if (!cached || cached.schemaSha !== schemaSha) {
        cached = { schemaSha, schema: deserializeSchema(serializedSchema) };
        this.fallbackSchemaCache.set(moduleFilePath, cached);
      }
      const errors = cached.schema["executeValidate"](
        moduleFilePath as string as SourcePath,
        source as SelectorSource,
      );
      this.onResult(moduleFilePath, errors);
    } catch (error) {
      console.error(
        "Validation fallback failed:",
        moduleFilePath,
        error instanceof Error ? error.message : String(error),
      );
      this.onResult(moduleFilePath, false);
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.pending = null;
    this.latestRequestId.clear();
    this.fallbackSchemaCache.clear();
  }
}
