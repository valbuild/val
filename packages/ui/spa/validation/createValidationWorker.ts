export function createValidationWorker(): Worker {
  return new Worker(new URL("./validation.worker.ts", import.meta.url), {
    type: "module",
  });
}
