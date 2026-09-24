/**
 * The messages between the Studio and the worker it builds in.
 *
 * See `loadBuilder.ts` for why the builder lives in a worker at all: rolldown's
 * threaded wasm deadlocks on a page's main thread, which may not block.
 */

import type * as TanstackBuild from "@valbuild/tanstack-build";

/**
 * One call of a builder method the Studio uses, with that method's own
 * parameters -- so the worker's switch narrows the arguments with no cast.
 */
export type BuilderCall =
  | { method: "bakedGit"; args: Parameters<typeof TanstackBuild.bakedGit> }
  | { method: "rebakeGit"; args: Parameters<typeof TanstackBuild.rebakeGit> }
  | {
      method: "buildUserApp";
      args: Parameters<typeof TanstackBuild.buildUserApp>;
    }
  | {
      method: "publishArtifacts";
      args: Parameters<typeof TanstackBuild.publishArtifacts>;
    };

/** Studio -> worker. */
export type BuilderRequest =
  /**
   * Load the builder. `wasmUrl` is the page's `__VAL_ROLLDOWN_WASM_URL__`
   * override, carried over because a worker has a global of its own and the
   * deployment wrote only the page's.
   */
  | { type: "init"; wasmUrl: string | null }
  | ({ type: "call"; id: number } & BuilderCall);

/** What each method answered, with that method's own result type. */
export type BuilderResult =
  | { method: "bakedGit"; value: ReturnType<typeof TanstackBuild.bakedGit> }
  | { method: "rebakeGit"; value: ReturnType<typeof TanstackBuild.rebakeGit> }
  | {
      method: "buildUserApp";
      value: Awaited<ReturnType<typeof TanstackBuild.buildUserApp>>;
    }
  | {
      method: "publishArtifacts";
      value: Awaited<ReturnType<typeof TanstackBuild.publishArtifacts>>;
    };

/** Worker -> Studio. */
export type BuilderReply =
  | { type: "ready" }
  | { type: "load-failed"; message: string }
  | ({ type: "result"; id: number } & BuilderResult)
  | { type: "error"; id: number; message: string };
