import type { ValConfig } from "@valbuild/core";

/**
 * Just the part of `ValServerConfig` this decision needs.
 *
 * Narrower than the whole thing on purpose: a `ValServerConfig` carries the api
 * key, the secret and the content URLs, and a function that took one would look
 * like it might consult them. It also makes this testable with an object
 * literal rather than a cast.
 */
type ClientConfigSource =
  | { mode: "fs"; project?: string; config: ValConfig }
  | { mode: "memory"; project?: string; config: ValConfig }
  | {
      mode: "http";
      project?: string;
      git?: { branch: string };
      config: ValConfig;
    };

/**
 * The `val.config` the Studio is told about, which is not quite the one on disk.
 *
 * `gitBranch` is optional in `val.config`, and a proxy-mode server that mirrors
 * into a repository usually knows the branch when the file does not: setting it
 * in the environment is how a Vercel deployment does it
 * (`VERCEL_GIT_COMMIT_REF`), and the example app does not set it at all.
 *
 * Git is OPTIONAL in http mode — a project can run on credentials alone, with
 * no repository to mirror into — so "http" no longer implies a branch exists.
 * That changed under this function rather than being designed into it: the
 * original said proxy mode "refuses to start without `VAL_GIT_BRANCH`", which
 * was true when it was written and is not any more. With no mirror there is
 * nothing to fill in and nothing to say, which is the same answer fs mode gets.
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
 * - **Every other mode is left alone.** Neither `fs` nor `memory` has a branch:
 *   `ValOpsFS` has no commits of its own, and a memory host holds its own
 *   source and never had any. Nor does an http project with no git mirror. The
 *   shell hides what needs a branch rather than being handed a name that means
 *   nothing.
 *
 * The modes are enumerated rather than written as "http, or anything else", and
 * that is worth keeping: `memory` arrived after this function did, and spelling
 * every mode out is what turned "does this one have a branch?" into a compile
 * error somebody had to answer instead of a default that silently applied.
 */
export function clientConfig(options: ClientConfigSource): ValConfig {
  const config = withResolvedProject(options.config, options.project);
  if (options.mode !== "http" || options.git === undefined) {
    return config;
  }
  if (config.gitBranch !== undefined) {
    return config;
  }
  return { ...config, gitBranch: options.git.branch };
}

/**
 * The project, filled in the same way and for the same reason as the branch.
 *
 * `project` may come from `VAL_PROJECT` rather than from `val.config`, and the
 * server talks to that project either way. The Studio decides from
 * `config.project` whether there is an assistant to offer at all (`wsEnabled`
 * in `ValProvider`), so a project named only in the environment would have
 * had it hidden while the server behind it was ready to serve it.
 *
 * `val.config` wins, as it does for the branch, and every mode gets it: unlike
 * a branch, a project means the same thing in fs mode as in http mode.
 */
function withResolvedProject(
  config: ValConfig,
  project: string | undefined,
): ValConfig {
  if (config.project !== undefined || project === undefined) {
    return config;
  }
  return { ...config, project };
}
