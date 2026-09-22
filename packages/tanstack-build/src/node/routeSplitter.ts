// autoCodeSplitting, using TanStack's own splitter.
//
// `@tanstack/router-plugin` splits a route file into a reference half and a
// deferred half. It is built on @babel/core, which does not run in a browser --
// bundled for the browser target it evaluates as far as
// `require('@babel/traverse')`, because Babel requires its own packages by name
// at module scope. So the split happens here, where Node is.
//
// A browser build simply does not split. That is allowed to differ by
// environment, unlike Tailwind's `@plugin`, because the difference is bundle
// size rather than behaviour: an unsplit route component renders identically,
// it just ships in the entry.
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { RouteSplitter } from "../build";

/**
 * What the compilers are given, which is only ever what `shared()` below builds.
 *
 * Typed here rather than left as `any` because this side constructs it: the
 * plugin's own types are not reachable (these are internals, loaded by file
 * path, and its `exports` map does not list them), but the shape handed over
 * is not a mystery.
 */
type SplitOptions = {
  code: string;
  filename: string;
  id: string;
  codeSplitGroupings: unknown;
  targetFramework: "react";
  runtimeEnv: "prod";
  splitTargets?: Array<string>;
};

type Compilers = {
  compileCodeSplitReferenceRoute: (
    opts: SplitOptions,
  ) => { code: string } | null;
  compileCodeSplitVirtualRoute: (opts: SplitOptions) => { code: string };
};

/**
 * Loads the compilers from the installed plugin.
 *
 * By file path, not by specifier: these are internals and the package's
 * `exports` does not list them, so a subpath import is refused. That is also
 * why `packages/upstream` pins the file -- if it moves, this breaks, and the
 * drift check is what says so first.
 *
 * "Not installed" and "installed but moved" are different outcomes on purpose.
 * The first is fine, and means no splitting. The second is the thing worth
 * hearing about, and a bare catch around both would have hidden it -- as it
 * did, the first time this was written.
 *
 * Resolved from the PROJECT, not from here, and that changed with the move to
 * npm. `autoCodeSplitting` is something a project asks for by installing the
 * plugin, so the plugin is the project's dependency and its version is
 * whatever the project's lockfile pinned -- exactly like a Tailwind plugin and
 * exactly like the vendor layer. Resolving from this module would ask which
 * copy the *publisher* happens to have hoisted, which is nobody's decision.
 */
async function loadCompilers(
  dir: string,
): Promise<(Compilers & { groupings: unknown }) | null> {
  let core: string;
  try {
    // Absolute: `createRequire` rejects a relative path, and the dir arrives
    // however the caller spelled it.
    const require = createRequire(join(resolve(dir), "package.json"));
    core = join(
      dirname(require.resolve("@tanstack/router-plugin/package.json")),
      "dist/esm/core",
    );
  } catch {
    return null; // not installed; the project did not ask for splitting
  }

  try {
    const compilers = (await import(
      pathToFileURL(join(core, "code-splitter/compilers.js")).href
    )) as Compilers;
    const constants = (await import(
      pathToFileURL(join(core, "constants.js")).href
    )) as {
      defaultCodeSplitGroupings: unknown;
    };
    return { ...compilers, groupings: constants.defaultCodeSplitGroupings };
  } catch (error) {
    throw new Error(
      `@tanstack/router-plugin is installed but its code splitter could not be loaded: ` +
        `${String((error as Error)?.message ?? error).split("\n")[0]}. ` +
        `Its internals have moved.`,
      { cause: error },
    );
  }
}

/**
 * Returns a splitter, or null when the project has not installed the plugin.
 *
 * Null rather than throwing: not splitting is a valid outcome, and a project
 * that has not asked for it should not be made to install a build plugin.
 */
export async function routeSplitter(
  dir: string,
): Promise<RouteSplitter | null> {
  const compilers = await loadCompilers(dir);
  if (!compilers) return null;

  const shared = (id: string, code: string) => ({
    code,
    filename: id,
    id,
    codeSplitGroupings: compilers.groupings,
    targetFramework: "react" as const,
    runtimeEnv: "prod" as const,
  });

  return {
    reference(id, code) {
      // Null when the file has nothing to split, which is the common case --
      // a route with only a loader, or one whose component is already lazy.
      return compilers.compileCodeSplitReferenceRoute(shared(id, code));
    },
    virtual(id, code, targets) {
      return compilers.compileCodeSplitVirtualRoute({
        ...shared(id, code),
        splitTargets: targets,
      });
    },
  };
}
