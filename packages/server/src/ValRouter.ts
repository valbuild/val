import { ValConfig, ValModules, Internal } from "@valbuild/core";
import type { ValServerGenericResult } from "@valbuild/shared/internal";
import { createUIRequestHandler } from "@valbuild/ui/server";
import { ValServer, ValServerCallbacks } from "./ValServer";
import { initHandlerOptions } from "./valServerConfig";
import { nodePlatform } from "./nodePlatform";
import { createValRequestHandler } from "./ValRouterCore";

type Versions = {
  versions?: {
    core?: string;
    next?: string;
  };
};
import type { ValPatchStore } from "./ValOpsMemory";
import type { ValContentVersion, ValProposal } from "./proposal";
import type { CommitContext, CommitResult } from "./ValServer";

export type ValApiOptions = ValServerOverrides & ValConfig & Versions;

type ValServerOverrides = Partial<{
  /**
   * Override the Val API key.
   *
   * Typically this is set using VAL_API_KEY env var.
   *
   * NOTE: if this is set you must also set valSecret or VAL_SECRET env var.
   */
  apiKey: string;
  /**
   * Override the Val session key.
   *
   * This can be any randomly generated string.
   * It will be used for authentication between the frontend and val api
   * endpoints in this app.
   *
   * Typically this is set using VAL_SECRET env var.
   *
   * NOTE: if this is set you must also set apiKey or VAL_API_KEY env var.
   */
  valSecret: string;
  /**
   * Override the default the mode of operation.
   *
   * Typically this should not be set.
   *
   * "local" means that changes will be written to the local filesystem,
   * which is what you want when developing locally.
   *
   * "proxy" means that changes will proxied to https://admin.val.build
   * and eventually be committed in the Git repository.
   *
   * It will automatically be "proxy" if both VAL_API_KEY env var (or the apiKey property) and VAL_SECRET env var (or the valSecret property)
   * is set.
   *
   * If both is missing, it will default to "local".
   */
  mode: "proxy" | "local";
  /**
   * The project's source, by path -- and, by being present, the choice of an
   * in-memory store over the local filesystem.
   *
   * EXPERIMENTAL. For a host that HOLDS the project's source rather than having
   * it on a disk: it hands it over here, patches live in `patchStore`, and a
   * publish is whatever `commitPrepared` does with the files. See
   * `ValOpsMemory`.
   *
   * Selected by presence rather than by a `mode` value because unlike "local"
   * and "proxy" this one cannot be inferred from the environment -- there is
   * nothing to infer it FROM, and a mode that can be turned on without
   * supplying the source would be a server with no content in it.
   *
   * An environment that has no disk can still say it EXPECTS this, by setting
   * `VAL_MODE=memory`. That does not select the mode; it makes forgetting to
   * pass the source an error here rather than an `EPERM` from `fs` mode two
   * layers down.
   */
  sourceFiles: Record<string, string>;
  /**
   * Serve memory mode without authenticating any request. Off by default.
   *
   * Set this only when the host authorises every request before it reaches
   * Val. Without it, memory mode requires a verified session like `http` mode
   * does -- unlike `fs` mode, this one runs deployed, so an unauthenticated
   * server is one where anyone who can reach the port can create patches and
   * trigger a publish.
   */
  unsafelyAllowUnauthenticated?: boolean;
  /**
   * Where pending patches live, with {@link sourceFiles}. Defaults to memory,
   * which is not durable -- see `ValPatchStore`.
   */
  patchStore: ValPatchStore;
  /**
   * The git commit this code was built from, and the branch a publish mirrors
   * into -- for a project that HAS a repository.
   *
   * OPTIONAL, including in http mode, and absent is the normal case for a
   * project whose content service is the store of record. It used to be
   * required, which made a repository a precondition for editing anything: a
   * deployment with no commit to name fell through to `fs` mode and reached
   * for a working tree that was not there.
   *
   * What it is FOR, where there is one: a publish turns pending patches into
   * new `.val.ts` text, and to patch a file you must first read it. That read
   * goes to the content service AT THIS COMMIT. Give it a commit the deployed
   * code did not come from and the publish writes over a different version of
   * the file than the one the site is running.
   *
   * It is NOT what a committed render reads -- that reads the source compiled
   * into the build and asks the content service nothing.
   *
   * A normal deploy bakes this at build time, because the commit really is a
   * property of those bytes. `VAL_GIT_COMMIT` / `VAL_GIT_BRANCH` supply it
   * where a build system sets environment variables instead.
   *
   * FLAT, and the same two names `val.config.ts` uses, so that there is one
   * way to say this rather than two. An app reads these off its platform --
   * `process.env.VERCEL_GIT_COMMIT_SHA` and friends, which are typed
   * `string | undefined` -- and a pair of optional strings takes that as it
   * comes. A nested `{ commit, branch }` would make every caller write the
   * ternary that turns two maybe-strings into one maybe-object. Sharing the
   * names with `ValConfig` is what makes the bindings' `{ versions,
   * ...config }` carry them here with nothing to map.
   *
   * Taken together or not at all: `initHandlerOptions` refuses one without
   * the other rather than resolving half a repository.
   *
   * @example "e83c5163316f89bfbde7d9ab23ca2e25604af290"
   */
  gitCommit?: string;
  /**
   * The branch a publish mirrors into. See {@link ValApiOptions.gitCommit},
   * which this is required with and meaningless without.
   *
   * @example "main"
   */
  gitBranch?: string;
  /**
   * The project's own source files, by path with no leading slash, as the
   * RUNNING build was made from them.
   *
   * Where a publish reads the `.val.ts` text it patches. Without it that text
   * is fetched from the content service at {@link gitCommit}, which only a
   * project with a repository has -- so a project whose content service is the
   * store of record could not produce `.val.ts` at all, and a build made after
   * a save carried none of the save's edits. A host that builds the project
   * itself embeds its source in the build and hands it over here.
   */
  projectSource?: Record<string, string>;
  /**
   * The publish job the RUNNING build was made for, when a Studio built it in
   * a tab. Such a build has no commit to name its place in the content
   * service's chain with, so it names its job, and the service places it by
   * that rather than at whichever build is live.
   */
  publishJob?: string;
  /**
   * The build the platform is running this server in, by its hash, when a
   * platform says (`VAL_BUILD`). Sent with every position this server asks
   * the content service about, because it is the one thing that says WHICH
   * build is asking: after a publish, an edge can keep serving the previous
   * build for up to a minute, and without it that build is placed at the new
   * one -- whose changes it does not hold, so they drop out of the overlay.
   */
  publishBuild?: string;
  /**
   * The proposal this server runs at the address of, when a platform serves
   * one. See {@link ValProposal}: its branch, its position, its save route,
   * and the snapshot that replaces the bundle's Source for what it saved.
   */
  proposal?: ValProposal;
  /**
   * The content version the site serves, when a platform says it differs from
   * the one this build bundles (`VAL_CONTENT`; read it with `contentFromEnv`).
   * See {@link ValContentVersion}: its Source replaces the bundle's for what
   * it holds, and its publish is this server's position. Ignored at a
   * proposal's address.
   */
  contentVersion?: ValContentVersion;
  /**
   * The base url of Val.
   *
   * Typically this should not be set.
   *
   * Can also be overridden using the VAL_BUILD_URL env var.
   *
   * @example "https://admin.val.build"
   */
  valBuildUrl: string;
  /**
   * The base url of Val content.
   *
   * Typically this should not be set.
   *
   * Can also be overridden using the VAL_CONTENT_URL env var.
   *
   * @example "https://content.val.build"
   */
  valContentUrl: string;
  /**
   * The full project name of the Val project.
   *
   * @example "myorg/my-project"
   */
  project: string;
  /**
   * After Val is enabled, redirect to this url.
   *
   * May be used to setup a custom flow after enabling Val.
   *
   *This can be set using the VAL_ENABLE_REDIRECT_URL env var.
   *
   * @example "/api/draft/enable"
   */
  valEnableRedirectUrl?: string;
  /**
   * After Val is disabled, redirect to this url.
   *
   * May be used to setup a custom flow after disabling Val.
   *
   * This can be set using the VAL_DISABLE_REDIRECT_URL env var.
   *
   * @example "/api/draft/enable"
   */
  valDisableRedirectUrl?: string;
  /**
   * Disable the cache.
   */
  disableCache?: boolean;
}>;

export async function createValServer(
  valModules: ValModules,
  route: string,
  opts: ValApiOptions,
  config: ValConfig,
  callbacks: ValServerCallbacks,
  formatter?: (code: string, filePath: string) => string | Promise<string>,
  /**
   * Called after a save has applied its patches. EXPERIMENTAL — see
   * `ValServerOptions.commitPrepared`.
   */
  commitPrepared?: (commit: {
    patchedSourceFiles: Record<string, string | null>;
  }) => Promise<void>,
  /**
   * What a publish does in http mode. EXPERIMENTAL — see
   * `ValServerOptions.publishOverride`.
   */
  publishOverride?: (context: CommitContext) => Promise<CommitResult>,
): Promise<ValServer> {
  const valServerConfig = await initHandlerOptions(route, opts, config);
  return ValServer(
    valModules,
    {
      formatter,
      commitPrepared,
      publishOverride,
      ...valServerConfig,
    },
    callbacks,
    nodePlatform,
  );
}

// TODO: remove
/**
 * `fs` and `path` are imported INSIDE this function, not at the top of the file.
 *
 * This is the only thing in this module that touches either, and it is a local
 * development convenience: scanning upwards for a `.git` to guess the commit and
 * branch. A static import put `fs` in the module graph of everything reaching
 * `createValApiRouter` -- which is every server integration, including ones that
 * run where there is no filesystem. Workerd provides no `fs`, so such a build
 * could not be bundled at all without stubbing it.
 *
 * The `await import` costs nothing here: the only caller is the CLI, on a
 * machine that has both.
 */
export async function safeReadGit(
  cwd: string,
): Promise<{ commit?: string; branch?: string }> {
  const { promises: fs } = await import("fs");
  const path = await import("path");
  async function findGitHead(
    currentDir: string,
    depth: number,
  ): Promise<{ commit?: string; branch?: string }> {
    const gitHeadPath = path.join(currentDir, ".git", "HEAD");
    if (depth > 1000) {
      Internal.log.error(
        `Reached max depth while scanning for .git folder. Current working dir: ${cwd}.`,
      );
      return {
        commit: undefined,
        branch: undefined,
      };
    }

    try {
      const headContents = await fs.readFile(gitHeadPath, "utf-8");
      const match = headContents.match(/^ref: refs\/heads\/(.+)/);
      if (match) {
        const branchName = match[1];
        return {
          branch: branchName,
          commit: await readCommit(currentDir, branchName),
        };
      } else {
        return {
          commit: undefined,
          branch: undefined,
        };
      }
    } catch {
      const parentDir = path.dirname(currentDir);

      // We've reached the root directory
      if (parentDir === currentDir) {
        return {
          commit: undefined,
          branch: undefined,
        };
      }
      return findGitHead(parentDir, depth + 1);
    }
  }

  try {
    return findGitHead(cwd, 0);
  } catch (err) {
    Internal.log.error("Error while reading .git", err);
    return {
      commit: undefined,
      branch: undefined,
    };
  }
}

/** Only reached from {@link safeReadGit}; same reason for the local imports. */
async function readCommit(
  gitDir: string,
  branchName: string,
): Promise<string | undefined> {
  const { promises: fs } = await import("fs");
  const path = await import("path");
  try {
    return (
      await fs.readFile(
        path.join(gitDir, ".git", "refs", "heads", branchName),
        "utf-8",
      )
    ).trim();
  } catch {
    return undefined;
  }
}

export function createValApiRouter<Res>(
  route: string,
  valServerPromise: Promise<ValServer>,
  convert: (valServerRes: ValServerGenericResult) => Res,
): (req: Request) => Promise<Res> {
  const uiRequestHandler = createUIRequestHandler();
  return createValRequestHandler(
    route,
    valServerPromise,
    convert,
    uiRequestHandler,
  );
}
