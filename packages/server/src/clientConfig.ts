import type { ValConfig } from "@valbuild/core";

/**
 * Just the part of `ValServerConfig` this decision needs.
 *
 * Narrower than the whole thing on purpose: a `ValServerConfig` carries the api
 * key, the secret and the content URLs, and a function that took one would look
 * like it might consult them. It also makes this testable with an object
 * literal rather than a cast.
 */
type BranchSource =
  | { mode: "fs"; config: ValConfig }
  | { mode: "http"; branch: string; config: ValConfig };

/**
 * The `val.config` the Studio is told about, which is not quite the one on disk.
 *
 * `gitBranch` is optional in `val.config`, but proxy mode refuses to start
 * without `VAL_GIT_BRANCH` — it is what every commit is filed under and what
 * every history read is listed by. So in that mode the server always knows the
 * branch, and the file often does not name it: setting it in the environment is
 * how a Vercel deployment does it (`VERCEL_GIT_COMMIT_REF`), and the example app
 * does not set it at all.
 *
 * The Studio reads `config.gitBranch` and nothing else, so without this a
 * correctly configured project gets a History pane reading "this project has no
 * gitBranch configured" while the server behind it is busy committing to one,
 * and a status bar with no branch on it.
 *
 * Narrow on purpose:
 *
 * - **`val.config` wins.** A branch named in the file is the author's answer,
 *   and the environment's is the fallback.
 * - **fs mode is left alone.** There is no branch there — `ValOpsFS` has no
 *   commits of its own — and the shell hides what needs one rather than being
 *   handed a name that means nothing.
 */
export function clientConfig(options: BranchSource): ValConfig {
  if (options.mode !== "http") {
    return options.config;
  }
  if (options.config.gitBranch !== undefined) {
    return options.config;
  }
  return { ...options.config, gitBranch: options.branch };
}
