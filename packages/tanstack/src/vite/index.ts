/**
 * `@valbuild/tanstack/vite`: build-time support for a site's Val server.
 *
 * `valProjectSource()` embeds the project's own Val source in the server
 * bundle, as the virtual module `virtual:val/project-source`. A site with no
 * repository behind it (a self-hosted installation keeps the content, and
 * mirrors it to git through its app) needs it to publish: rendering a change
 * back into `.val.ts` starts from the file's current text, and this is that
 * text, exactly as the build was made from it.
 *
 * ```ts
 * // vite.config.ts
 * import { valProjectSource } from "@valbuild/tanstack/vite";
 * export default defineConfig({ plugins: [valProjectSource(), tanstackStart()] });
 *
 * // src/val/server.ts
 * import projectSource from "virtual:val/project-source";
 * initValServer(valModules, config, { projectSource });
 * ```
 *
 * The same contract as the build platform's `platform:project-source`, made by
 * a different builder: there the files come from the record the platform
 * builds from, here from the project's directory.
 *
 * A second publish before the site is rebuilt is safe: the text is the
 * build's, and a publish replays over it what was published since the build
 * before its own changes (`publishedByModule` in `@valbuild/server`, and
 * "What a publish patches" in `architecture/content-versions.md`).
 * `scenarios/src/publishBeforeRedeploy.scenario.test.ts` publishes twice
 * from embedded source with no redeploy in between.
 *
 * NOT YET for a site whose content service publishes as JOBS (val.build
 * does): a deployment that embeds its source is taken to be one the Studio
 * can build in a tab (`buildable` in `ValServer`'s `/publish-job-prepare`),
 * which is the platform's model and not a self-hosted site's, built by its
 * own CI. A self-hosted engine with no serving plane publishes by commit, so
 * it never asks; one that runs jobs needs embedding and building in the tab
 * told apart. That is also why `examples/tanstack` does not use this: its
 * proxy-mode e2e stands in for val.build, and its job specs would try to
 * build in the tab.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** The id a site's Val server imports. */
export const PROJECT_SOURCE_MODULE = "virtual:val/project-source";
const RESOLVED = `\0${PROJECT_SOURCE_MODULE}`;

/**
 * Val's source, and nothing else: the files a publish renders into, and the
 * module list and config they are read with. Not the whole project -- the
 * server has no use for it, and a bigger bundle is all it would buy.
 */
export function isValSourceFile(name: string): boolean {
  return (
    /\.val\.(ts|js|json)$/.test(name) ||
    /^val\.(modules|config)\.(ts|js|mjs|mts)$/.test(name)
  );
}

/** Never walked: dependencies, VCS, and what builds and tools write. */
const SKIPPED = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".output",
  ".vinxi",
  ".tanstack",
  ".nitro",
  ".netlify",
  ".vercel",
  ".val",
  "coverage",
]);

/** The project's Val source, by posix path from `root`, with no leading slash. */
export function readProjectSource(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIPPED.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && isValSourceFile(entry.name))
        files[relative(root, full).split(sep).join("/")] = readFileSync(
          full,
          "utf8",
        );
    }
  };
  walk(root);
  return files;
}

/**
 * What of Vite's plugin API this uses, typed here so the package needs no
 * dependency on `vite`: any Vite from 5 on accepts the object.
 */
export type ValProjectSourcePlugin = {
  name: string;
  configResolved(config: { root: string }): void;
  resolveId(id: string): string | undefined;
  load(
    this: {
      addWatchFile?(file: string): void;
      environment?: { config?: { consumer?: string } };
    },
    id: string,
    options?: { ssr?: boolean },
  ): string | undefined;
};

export function valProjectSource(
  options: {
    /** The project root, if not Vite's own `root`. */
    root?: string;
  } = {},
): ValProjectSourcePlugin {
  let root = options.root ?? process.cwd();
  return {
    name: "val:project-source",
    configResolved(config) {
      root = options.root ?? config.root;
    },
    resolveId(id) {
      return id === PROJECT_SOURCE_MODULE ? RESOLVED : undefined;
    },
    load(id, loadOptions) {
      if (id !== RESOLVED) return undefined;
      const consumer = this.environment?.config?.consumer;
      const onServer =
        consumer !== undefined ? consumer === "server" : loadOptions?.ssr;
      if (onServer === false) {
        // Every source file of the project, in every visitor's browser.
        throw new Error(
          `${PROJECT_SOURCE_MODULE} is server-only: it embeds the project's source. Import it from your Val server (src/val/server.ts), never from code that runs in the browser.`,
        );
      }
      const files = readProjectSource(root);
      // An edit to a Val file is seen without restarting the dev server.
      for (const path of Object.keys(files))
        this.addWatchFile?.(join(root, path));
      return `export const FILES = ${JSON.stringify(files)};\nexport default FILES;\n`;
    },
  };
}

/**
 * The same exports, as one object: `import valVite from "@valbuild/tanstack/vite"`.
 *
 * For a config Node loads as an ES module from a source checkout of this
 * package (Val's own monorepo), where the CommonJS entry is preconstruct's
 * dev redirect and Node cannot see its names. From npm, import by name.
 */
const valVite = { valProjectSource, readProjectSource, PROJECT_SOURCE_MODULE };
export default valVite;
