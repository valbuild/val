import path from "path";

/**
 * What Val calls to format a file it has just written.
 *
 * The same shape `initValServer`, `initValMcp` and `ValOps` take as their
 * `formatter` option. The path is the file's path INSIDE the project — a
 * `ModuleFilePath` such as `/content/page.val.ts`, or a `*.val.json` entry
 * beside it — never an absolute path on disk, because the writers that call it
 * (`ValOps.prepare`, the CLI's `--fix`) only ever know a module by that path.
 */
export type ValFormatter = (
  code: string,
  filePath: string,
) => Promise<string> | string;

/**
 * Prettier's options, as far as this file is concerned.
 *
 * Deliberately opaque: this file never reads an option, it only carries the
 * bag from `resolveConfig` to `format`. Naming the real `Options` here would
 * make it a compile error to build `@valbuild/server` in a project that has no
 * prettier installed, which is most of them — prettier is a dependency the app
 * opts into, so it is passed IN rather than imported.
 */
export type PrettierLikeConfig = object;

/**
 * `prettier`, as this file wants it.
 *
 * Structural for the same reason `SharpLike` in `@valbuild/mcp` is: a type-only
 * import of a package that is not installed is still a compile error, and this
 * package has to typecheck without prettier. `createPrettierFormatter.test.ts`
 * asserts the real library against this type so the structural description
 * cannot drift away from it unnoticed.
 *
 * Every result is `T | Promise<T>` so that `@prettier/sync` — the same API with
 * the awaits taken out — satisfies it too. Everything here is awaited either
 * way, and a formatter is allowed to be synchronous: `ValFormatter` says so.
 */
export type PrettierLike = {
  format(
    source: string,
    options: PrettierLikeConfig & { filepath: string },
  ): Promise<string> | string;
  resolveConfig(
    filePath: string,
  ): Promise<PrettierLikeConfig | null> | PrettierLikeConfig | null;
  getFileInfo(
    filePath: string,
    options: { ignorePath: string[] },
  ): Promise<{ ignored: boolean }> | { ignored: boolean };
};

/**
 * Resolve a path Val handed us against the project.
 *
 * Val's writers pass a project-relative path (`/content/page.val.ts`), and
 * prettier needs a real one — both to find the `.prettierrc` that governs the
 * file and to match it against `.prettierignore`. An absolute path that is
 * already inside the project is taken as it comes, so a caller that happens to
 * hold a real path is not mangled into `<root>/<root>/...`.
 */
function resolveAgainstProject(projectRoot: string, filePath: string): string {
  if (path.isAbsolute(filePath)) {
    const relative = path.relative(projectRoot, filePath);
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
      return filePath;
    }
  }
  return path.join(projectRoot, filePath);
}

/**
 * A {@link ValFormatter} that formats the way the project itself does.
 *
 * ONE implementation, for every writer of source files Val has: the Studio and
 * the dev server (`initValServer`), an agent (`initValMcp`) and
 * `val validate --fix`. They used to disagree — the CLI called
 * `prettier.format(code, { filepath })` on its own behalf, and `format` does
 * not read `.prettierrc`; only `resolveConfig`, `getFileInfo` and the prettier
 * CLI do. `filepath` there selects the PARSER and nothing else, so the output
 * was valid TypeScript in prettier's default style rather than the project's:
 * a two-line content fix arriving as a whole-file rewrite, and a red `format`
 * job in any repo that checks formatting in CI.
 *
 * ```ts
 * import prettier from "prettier";
 * import { createPrettierFormatter } from "@valbuild/next/server";
 *
 * initValServer(valModules, config, {
 *   draftMode,
 *   formatter: createPrettierFormatter(prettier, { projectRoot: process.cwd() }),
 * });
 * ```
 *
 * `projectRoot` is what a project-relative path is resolved against, and is
 * therefore also where `.prettierignore` is looked for. Prettier's own config
 * search walks UP from the resolved file, so a monorepo package with its own
 * `.prettierrc` is found without being named here.
 *
 * Two decisions worth knowing:
 *
 * - **`.prettierignore` is honoured; `.gitignore` is not.** The prettier CLI
 *   consults both, but only one of them is a statement about formatting — a
 *   file is gitignored for reasons that have nothing to do with style, and the
 *   only files reaching this function are ones Val itself just wrote.
 * - **No config found is not an error.** `resolveConfig` returns `null` and
 *   the file is formatted with prettier's defaults, which is what a project
 *   without a config has asked for.
 */
export function createPrettierFormatter(
  prettier: PrettierLike,
  options: { projectRoot: string },
): ValFormatter {
  const projectRoot = path.resolve(options.projectRoot);
  // One array, built once: prettier reads and caches the ignore file itself, so
  // this is only here to avoid rebuilding the path per file.
  const ignorePath = [path.join(projectRoot, ".prettierignore")];
  return async (code: string, filePath: string): Promise<string> => {
    const absoluteFilePath = resolveAgainstProject(projectRoot, filePath);
    const { ignored } = await prettier.getFileInfo(absoluteFilePath, {
      ignorePath,
    });
    if (ignored) {
      return code;
    }
    // `resolveConfig` applies the `overrides` that match this file and caches
    // per directory, so calling it per file is cheap even on a project-wide
    // `--fix`. `filepath` is still required: it is what picks the parser.
    const config = await prettier.resolveConfig(absoluteFilePath);
    return prettier.format(code, {
      ...config,
      filepath: absoluteFilePath,
    });
  };
}
