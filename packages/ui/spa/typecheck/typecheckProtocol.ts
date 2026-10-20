import type { TypecheckProgress, TypecheckResult } from "./typecheckProject";

/**
 * The messages between the Studio and the typecheck worker
 * (`typecheck.worker.ts`).
 *
 * The worker fetches the bundles itself, from `base` on the page's own
 * origin, so the megabytes of declaration text never cross into the page:
 * only the result does.
 */

/** Studio -> worker. */
export type TypecheckRequest = {
  type: "check";
  id: number;
  files: Record<string, string>;
  lockfile: string;
  workspace: string | null;
  /** Where adept is reached, e.g. `/api/val/publish-api/adept`. */
  base: string;
};

/** A failure, as plain data: an `Error` loses its fields on the way through `postMessage`. */
export type TypecheckFailure = {
  message: string;
  code: string;
  retryable: boolean;
  status: number | null;
};

/** Worker -> Studio. */
export type TypecheckReply =
  | { type: "progress"; id: number; progress: TypecheckProgress }
  | { type: "result"; id: number; result: TypecheckResult }
  | { type: "error"; id: number; failure: TypecheckFailure };

/** The check was abandoned before it finished: the page left, or started another. */
export class TypecheckAbandoned extends Error {}
