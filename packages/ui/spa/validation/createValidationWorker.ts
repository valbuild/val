import type { ValidationWorkerFactory } from "./ValidationWorkerClient";

// Constructed the same way as the search and patchsets workers: Vite rewrites
// new URL(..., import.meta.url) to an absolute, base-prefixed asset URL, so the
// worker resolves regardless of where the SPA entry is served.
//
// This is the only file that references import.meta. It is imported solely by
// the app composition root (ValProvider) and passed into ValSyncEngine, keeping
// import.meta out of the test-compiled core (ValSyncEngine / ValidationWorkerClient).
export const createValidationWorker: ValidationWorkerFactory = () =>
  new Worker(new URL("./validation.worker.ts", import.meta.url), {
    type: "module",
  });
