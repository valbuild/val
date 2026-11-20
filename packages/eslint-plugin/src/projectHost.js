// @ts-check

/**
 * What the rules need to know about the project a file is in, beyond the file
 * itself.
 *
 * Two rules need it: `no-illegal-module-paths` (which path a module must name,
 * which is the file's path from the project's root) and
 * `module-in-val-modules` (which files `val.modules.ts` registers). In an
 * editor or `eslint .` the answers come from the disk (`nodeHost.js`); in the
 * Studio, where the project is a proposal's files in memory and there is no
 * disk, they come from those files. The rules are the same either way, which
 * is the point: the assistant is checked by the rules a developer is.
 *
 * Nothing here may import `fs`, `path` or `typescript`: this module and the
 * rules are what `@valbuild/eslint-plugin/rules` gives a browser.
 *
 * @typedef {Object} ValProjectHost
 * @property {(filename: string, cwd: string) => string | undefined} modulePathOf
 *   The path `c.define` in `filename` must name: its path from the project's
 *   root, with a leading `/` (`/src/content/home.val.ts`). `undefined` when
 *   it cannot be told.
 * @property {(cwd: string) => ReadonlyArray<string> | null} registeredModules
 *   The files `val.modules.ts` registers, as filenames comparable to
 *   `context.filename`, or `null` when the project has no `val.modules.ts`.
 * @property {(filename: string, cwd: string) => string} displayPath
 *   `filename` as a message names it: from the project's root.
 */

/**
 * The module specifiers `val.modules.ts` registers: every
 * `import("./....val")`, as written.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function registeredSpecifiers(text) {
  return Array.from(
    text.matchAll(/import\(["'](.+\.val(?:\.[jt]s)?)['"]\)/g),
    (match) => match[1],
  );
}
