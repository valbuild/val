import fs from "fs";
import path from "path";
import { DEFAULT_CONTENT_HOST, ValConfig, ValModules } from "@valbuild/core";
import {
  getPersonalAccessTokenPath,
  loadValModules,
  parsePersonalAccessTokenFile,
  safeReadGit,
  ValOpsFS,
  ValOpsHttp,
} from "@valbuild/server";
import { evalValConfigFile } from "../utils/evalValConfigFile";

/**
 * Everything the debug commands need in order to talk to the same ops the
 * running app talks to.
 *
 * Mirrors how the app itself decides between fs and http mode in
 * `initHandlerOptions` (packages/server/src/ValRouter.ts): a project name plus
 * credentials means the patches live in the hosted content service, otherwise
 * they are on disk under `<root>/.val`.
 */
export type DebugContext = {
  projectRoot: string;
  valModules: ValModules;
  config: ValConfig;
  mode: "fs" | "http";
  project: string | null;
  branch: string | null;
  commit: string | null;
  /** How we authenticated, for the snapshot manifest. Never the secret itself. */
  authKind: "pat" | "api-key" | "none";
  contentUrl: string;
  filesDirectory: string;
  serverOps: ValOpsFS | ValOpsHttp;
};

export class DebugContextError extends Error {}

export async function createDebugContext(options: {
  root?: string;
  commit?: string;
  branch?: string;
  /**
   * Read patches from the hosted content service rather than `<root>/.val`.
   *
   * Has to be explicit: whether a project's patches live remotely depends on
   * how the *deployed* app is configured (proxy mode), which a local checkout
   * cannot know. A `val login` token says nothing about it either - it is a user
   * credential, not a signal. We default to fs mode and let VAL_API_KEY (the
   * same thing that puts the app in proxy mode) opt in automatically.
   */
  remote?: boolean;
}): Promise<DebugContext> {
  const projectRoot = options.root ? path.resolve(options.root) : process.cwd();
  if (!fs.existsSync(projectRoot)) {
    throw new DebugContextError(`Project root does not exist: ${projectRoot}`);
  }
  const config =
    (await evalValConfigFile(projectRoot, "val.config.ts")) ||
    (await evalValConfigFile(projectRoot, "val.config.js"));
  if (!config) {
    throw new DebugContextError(
      `Could not find val.config.ts nor val.config.js in: ${projectRoot}`,
    );
  }
  const valModules = loadValModules(projectRoot);
  const contentUrl = process.env.VAL_CONTENT_URL || DEFAULT_CONTENT_HOST;
  const filesDirectory = config.files?.directory ?? "/public/val";
  const project = config.project || process.env.VAL_PROJECT || null;
  const git = await safeReadGit(projectRoot);
  const branch =
    options.branch ||
    config.gitBranch ||
    process.env.VAL_GIT_BRANCH ||
    git.branch ||
    null;
  const commit =
    options.commit ||
    config.gitCommit ||
    process.env.VAL_GIT_COMMIT ||
    git.commit ||
    null;

  const wantsRemote = options.remote || !!process.env.VAL_API_KEY;
  const auth = wantsRemote ? readAuth(projectRoot) : null;
  if (wantsRemote) {
    if (!project) {
      throw new DebugContextError(
        "Cannot read remote patches: no project is configured.\n" +
          "Set 'project' in val.config, or the VAL_PROJECT env var.",
      );
    }
    if (!auth) {
      throw new DebugContextError(
        "Cannot read remote patches: you are not logged in.\n\n\tnpx val login\n\n" +
          "(or set the VAL_API_KEY env var)",
      );
    }
    if (!branch) {
      throw new DebugContextError(
        "Could not determine the branch. Pass --branch, or set VAL_GIT_BRANCH.",
      );
    }
    if (!commit) {
      throw new DebugContextError(
        "Could not determine the commit. Pass --commit, or set VAL_GIT_COMMIT.\n" +
          "This must be the commit the app was deployed from: it is the commit the module sources are read at.",
      );
    }
    return {
      projectRoot,
      valModules,
      config,
      mode: "http",
      project,
      branch,
      commit,
      authKind: "pat" in auth ? "pat" : "api-key",
      contentUrl,
      filesDirectory,
      serverOps: new ValOpsHttp(
        contentUrl,
        project,
        commit,
        branch,
        auth,
        valModules,
        { root: config.root, config },
      ),
    };
  }
  return {
    projectRoot,
    valModules,
    config,
    mode: "fs",
    project,
    branch,
    commit,
    authKind: "none",
    contentUrl,
    filesDirectory,
    serverOps: new ValOpsFS(contentUrl, projectRoot, valModules, { config }),
  };
}

/**
 * The personal access token written by `val login`, falling back to the api key
 * the app itself uses. Reading the pat file is the same dance as
 * `resolveRemoteFile` in runValidation.ts.
 */
function readAuth(
  projectRoot: string,
): { pat: string } | { apiKey: string } | null {
  const patFile = getPersonalAccessTokenPath(projectRoot);
  if (fs.existsSync(patFile)) {
    const contents = fs.readFileSync(patFile, "utf-8");
    const parsed = parsePersonalAccessTokenFile(contents);
    if (parsed.success) {
      return { pat: parsed.data.pat };
    }
    throw new DebugContextError(
      `Could not parse the personal access token at ${patFile}: ${parsed.error}.\n` +
        `Log in again:\n\n\tnpx val login`,
    );
  }
  const apiKey = process.env.VAL_API_KEY;
  if (apiKey) {
    return { apiKey };
  }
  return null;
}
