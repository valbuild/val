import { createRequire } from "node:module";
import path from "node:path";
import type { Plugin } from "vite";

/**
 * What ESLint needs to run in the Studio: the assistant's `lint`
 * (`spa/proposals/valLint.ts`), which runs Val's eslint rules over a
 * proposal's files in the tab.
 *
 * ESLint's `eslint/universal` is its browser entry, but two of the modules it
 * reaches still assume Node:
 *
 * - `node:path`, which the linter uses for file names. `pathe` is the same
 *   POSIX functions for any runtime -- and a proposal's files are POSIX paths
 *   from the project's root, whatever machine the Studio runs on.
 * - `esquery`, which ESLint `require`s as CommonJS. A bundler resolving the
 *   bare name picks its ES module build, whose default export is the whole
 *   API, so `esquery.matches` is undefined and every lint throws.
 *
 * Redirected only for imports FROM ESLint's own packages, so nothing else in
 * the Studio is handed a different `path` or `esquery` than it asked for.
 */
export function eslintInBrowserPlugin({ root }: { root: string }): Plugin {
  const require = createRequire(path.join(root, "package.json"));
  // Its ES module build: `pathe` exports no `package.json` to find it by.
  const pathe = path.join(path.dirname(require.resolve("pathe")), "index.mjs");
  const esquery = path.join(
    path.dirname(require.resolve("esquery/package.json")),
    "dist/esquery.min.js",
  );
  const fromEslint = (importer: string | undefined) =>
    importer !== undefined && /[\\/](?:eslint|@eslint)[\\/]/.test(importer);
  return {
    name: "val:eslint-in-browser",
    enforce: "pre",
    resolveId(source, importer) {
      if (!fromEslint(importer)) return null;
      if (source === "node:path" || source === "path") return pathe;
      if (source === "esquery") return esquery;
      return null;
    },
  };
}
