import { domEndpoint } from "../stores/workerBridge";
import { startWorkerRealm } from "../stores/workerEntry";

/**
 * The benchmark's worker script: the real worker realm, in a real thread.
 *
 * Bundled separately from `entry.ts` and served at `/worker.js`, because the
 * page bundle is an IIFE that hangs itself off `window` — a global a worker does
 * not have. One entry per realm is also the shape a shipped Studio would have.
 *
 * The scope is taken as an ARGUMENT rather than reached for as `self`, so this
 * file type-checks against the DOM lib without an assertion: `Parameters` of
 * `domEndpoint` is exactly the `postMessage`/`addEventListener` pair a worker
 * global offers, and passing `self` in is checked against it at the one call
 * site below.
 */
export function serveIn(scope: Parameters<typeof domEndpoint>[0]): () => void {
  return startWorkerRealm(domEndpoint(scope)).stop;
}

serveIn(self);
